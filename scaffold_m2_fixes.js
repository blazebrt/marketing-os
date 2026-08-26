const fs = require('fs');
const path = require('path');

const write = (p, content) => {
  const full = path.join(process.cwd(), p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.trim() + '\n', 'utf-8');
};

write('supabase/migrations/002_secure_credentials.sql', `
-- 1. Remove credentials from integrations (preventing client leakage)
alter table public.integrations drop column if exists credentials;
alter table public.integrations add column if not exists external_id text;
alter table public.integrations add column if not exists last_verified_at timestamptz;
alter table public.integrations add column if not exists error_message text;

-- 2. Create secure credentials table
create table public.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  provider text not null,
  encrypted_credentials text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, provider)
);

-- 3. Enforce Strict Server-Only RLS
alter table public.integration_credentials enable row level security;
-- NO policies are created for anon or authenticated users. 
-- This guarantees Default Deny, meaning ONLY service_role can read/write this table.
`);

write('src/lib/crypto.ts', `
import crypto from 'crypto';

export function getEncryptionKey(): Buffer {
  const b64Key = process.env.ENCRYPTION_KEY;
  if (!b64Key) throw new Error('Configuration Error: ENCRYPTION_KEY is missing. System failing closed.');
  
  const keyBuffer = Buffer.from(b64Key, 'base64');
  if (keyBuffer.length !== 32) {
    throw new Error(\`Configuration Error: ENCRYPTION_KEY must be exactly 32 bytes when decoded. Got \${keyBuffer.length} bytes.\`);
  }
  return keyBuffer;
}

const ALGORITHM = 'aes-256-gcm';

export function encryptCredential(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return \`\${iv.toString('hex')}:\${authTag.toString('hex')}:\${encrypted}\`;
}

export function decryptCredential(text: string): string {
  const key = getEncryptionKey();
  const parts = text.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encryptedText = parts[2];
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
`);

write('src/lib/supabase/service.ts', `
import { createClient } from '@supabase/supabase-js';

// Secure Server-Side ONLY Client (Bypasses RLS for secure_credentials table)
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !serviceRoleKey) {
    throw new Error('Missing Supabase Service Role credentials');
  }
  
  return createClient(url, serviceRoleKey);
}
`);

write('src/lib/integrations.ts', `
import { createClient } from './supabase/server';
import { createServiceClient } from './supabase/service';
import { encryptCredential } from './crypto';
import { OAuth2Client } from 'google-auth-library';
import { logAudit } from './audit';

export async function verifyGoogleConnection(tokens: { access_token: string, refresh_token?: string }): Promise<{ safe: boolean; reason?: string; accountId?: string }> {
  if (!tokens.access_token) return { safe: false, reason: 'Missing access token' };

  try {
    const client = new OAuth2Client();
    client.setCredentials(tokens);

    const tokenInfo = await client.getTokenInfo(tokens.access_token);
    
    if (!tokenInfo.email) {
       return { safe: false, reason: 'No email associated with token' };
    }

    return { safe: true, accountId: tokenInfo.email }; // Using email as external_id for V1 test bounds
  } catch (e: any) {
    return { safe: false, reason: e.message };
  }
}

export async function upsertIntegration(
  ownerId: string, 
  provider: string, 
  credentials: any, 
  status: string,
  externalId?: string,
  errorMessage?: string
) {
  const standardClient = await createClient();
  const serviceClient = createServiceClient();
  
  // 1. Insert Metadata safely to client-readable table
  const { error: metaError } = await standardClient.from('integrations').upsert({
    owner_id: ownerId,
    provider,
    status,
    external_id: externalId,
    error_message: errorMessage,
    last_verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  if (metaError) throw metaError;

  // 2. Insert Credentials securely to server-only table
  if (credentials) {
    const safeCreds = { ...credentials };
    if (safeCreds.access_token) safeCreds.access_token = encryptCredential(safeCreds.access_token);
    if (safeCreds.refresh_token) safeCreds.refresh_token = encryptCredential(safeCreds.refresh_token);

    const { error: credError } = await serviceClient.from('integration_credentials').upsert({
      owner_id: ownerId,
      provider,
      encrypted_credentials: JSON.stringify(safeCreds),
      updated_at: new Date().toISOString()
    });

    if (credError) throw credError;
  }
}

export async function disconnectIntegration(ownerId: string, provider: string) {
  const standardClient = await createClient();
  const serviceClient = createServiceClient();
  
  // Update status
  await standardClient.from('integrations').update({
    status: 'disconnected',
    external_id: null,
    error_message: null,
    updated_at: new Date().toISOString()
  }).eq('owner_id', ownerId).eq('provider', provider);

  // Hard delete credentials using service role
  await serviceClient.from('integration_credentials').delete()
    .eq('owner_id', ownerId).eq('provider', provider);

  await logAudit(ownerId, 'INTEGRATION_DISCONNECTED', 'integration', null, null, null, \`Disconnected \${provider}\`);
}
`);

write('src/app/api/integrations/google/callback/route.ts', `
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { OAuth2Client } from 'google-auth-library';
import { upsertIntegration, verifyGoogleConnection } from '@/lib/integrations';
import { logAudit } from '@/lib/audit';
import { withIdempotency } from '@/lib/idempotency';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (errorParam) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, \`Provider error: \${errorParam}\`);
    return NextResponse.redirect(new URL('/integrations?error=provider_rejected', req.url));
  }

  // VALIDATE AND CONSUME STATE (Single-use enforcement)
  const cookieStore = await cookies();
  const storedState = cookieStore.get('oauth_state')?.value;
  
  // Immediately delete the cookie to prevent reuse
  cookieStore.delete('oauth_state');

  if (!state || state !== storedState) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, 'State mismatch / CSRF attempt');
    return NextResponse.redirect(new URL('/integrations?error=state_mismatch', req.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/integrations?error=missing_code', req.url));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || 'mock_client_id';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || 'mock_client_secret';
  const redirectUri = process.env.NEXT_PUBLIC_BASE_URL 
    ? \`\${process.env.NEXT_PUBLIC_BASE_URL}/api/integrations/google/callback\`
    : 'http://localhost:3000/api/integrations/google/callback';

  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

  const idempotencyKey = \`oauth_google_\${state}\`;

  try {
    await withIdempotency(idempotencyKey, user.id, 'oauth_exchange', async () => {
      let tokens;
      if (process.env.NODE_ENV === 'test' || clientId === 'mock_client_id') {
        tokens = { access_token: 'mock_access', refresh_token: 'mock_refresh' };
      } else {
        const { tokens: realTokens } = await oauth2Client.getToken(code);
        tokens = realTokens;
      }

      const verification = await verifyGoogleConnection(tokens as any);
      
      if (!verification.safe) {
        await upsertIntegration(user.id, 'google', null, 'error', undefined, verification.reason);
        await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, \`Verification failed: \${verification.reason}\`);
        throw new Error('Verification failed');
      }

      await upsertIntegration(user.id, 'google', tokens, 'connected', verification.accountId);
      
      await logAudit(user.id, 'OAUTH_CONNECTED', 'integration', null, null, null, 'Google OAuth successful');
      await logAudit(user.id, 'INTEGRATION_VERIFIED', 'integration', null, null, null, 'Google Ads connection verified');
      
      return true;
    });

    return NextResponse.redirect(new URL('/integrations?success=true', req.url));

  } catch (err: any) {
    return NextResponse.redirect(new URL(\`/integrations?error=\${encodeURIComponent(err.message)}\`, req.url));
  }
}
`);

write('src/app/integrations/page.tsx', `
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  // Client securely fetches ONLY metadata.
  // Credentials do not exist in this table anymore.
  const { data: integrations } = await supabase
    .from('integrations')
    .select('provider, status, external_id, last_verified_at, error_message')
    .eq('owner_id', user.id);

  const getMetadata = (provider: string): any => {
    const int = integrations?.find(i => i.provider === provider);
    return int || { status: 'disconnected', external_id: null, error_message: null };
  };

  const providers = [
    { id: 'google', name: 'Google Ads', description: 'Search and Performance Max campaigns', testAccounts: 'Manager: 595-645-2500, Customer: 160-026-9431' },
    { id: 'meta', name: 'Meta Ads', description: 'Facebook and Instagram advertising' },
    { id: 'instagram', name: 'Instagram', description: 'Organic creative syncing' },
    { id: 'whatsapp', name: 'WhatsApp', description: 'WhatsApp Business API' },
    { id: 'website', name: 'Website', description: 'Lead attribution via secure API' }
  ];

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Integrations</h1>
      <p className="mb-8 text-gray-600">Securely connect your advertising and tracking channels. Credentials are encrypted server-side and never exposed to the browser.</p>
      
      <div className="space-y-4">
        {providers.map(p => {
          const meta = getMetadata(p.id);
          const status = meta.status;
          return (
            <div key={p.id} className="border p-6 rounded-lg flex items-center justify-between bg-white shadow-sm">
              <div>
                <h3 className="font-semibold text-lg">{p.name}</h3>
                <p className="text-gray-500 text-sm">{p.description}</p>
                {p.testAccounts && <p className="text-xs text-blue-500 mt-1">V1 Bound to: {p.testAccounts}</p>}
                
                {meta.external_id && <p className="text-sm font-medium mt-2 text-green-700">Account: {meta.external_id}</p>}
                {meta.error_message && <p className="text-sm font-medium mt-2 text-red-600">Error: {meta.error_message}</p>}
              </div>
              <div className="flex items-center gap-4">
                <span className={\`px-3 py-1 rounded-full text-xs font-medium \${
                  status === 'connected' ? 'bg-green-100 text-green-800' :
                  status === 'error' ? 'bg-red-100 text-red-800' :
                  'bg-gray-100 text-gray-800'
                }\`}>
                  {status.toUpperCase()}
                </span>
                
                {status === 'connected' ? (
                  <form action="/api/integrations/disconnect" method="POST">
                    <input type="hidden" name="provider" value={p.id} />
                    <button type="submit" className="px-4 py-2 bg-red-50 text-red-600 rounded-md text-sm font-medium hover:bg-red-100">
                      Disconnect
                    </button>
                  </form>
                ) : (
                  <a 
                    href={p.id === 'google' ? '/api/integrations/google/connect' : '#'}
                    className="px-4 py-2 bg-black text-white rounded-md text-sm font-medium hover:bg-gray-800"
                  >
                    Connect
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
`);
console.log('Scaffold complete.');
