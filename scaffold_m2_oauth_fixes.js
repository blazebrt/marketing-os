const fs = require('fs');
const path = require('path');

const write = (p, content) => {
  const full = path.join(process.cwd(), p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.trim() + '\n', 'utf-8');
};

write('supabase/migrations/003_oauth_states.sql', `
-- 1. Create oauth_states table for cryptographically secure, single-use state
create table public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  provider text not null,
  state_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

-- 2. Prevent client exposure
alter table public.oauth_states enable row level security;
-- NO policies are created for anon or authenticated users. 
-- ONLY service_role can read/write this table.
`);

write('src/lib/oauthState.ts', `
import crypto from 'crypto';
import { createServiceClient } from './supabase/service';

/**
 * Creates a cryptographically random OAuth state, stores its hash with a TTL, and returns the raw string.
 */
export async function createOAuthState(ownerId: string, provider: string): Promise<string> {
  const rawState = crypto.randomBytes(32).toString('hex');
  const stateHash = crypto.createHash('sha256').update(rawState).digest('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

  const serviceClient = createServiceClient();
  const { error } = await serviceClient.from('oauth_states').insert({
    owner_id: ownerId,
    provider,
    state_hash: stateHash,
    expires_at: expiresAt
  });

  if (error) {
    throw new Error('Failed to generate secure OAuth state');
  }

  return rawState;
}

/**
 * Atomically consumes an OAuth state hash.
 * Ensures that even under concurrent double-callback attempts, only exactly ONE succeeds.
 */
export async function consumeOAuthState(ownerId: string, provider: string, rawState: string): Promise<boolean> {
  const stateHash = crypto.createHash('sha256').update(rawState).digest('hex');
  const serviceClient = createServiceClient();

  const { data, error } = await serviceClient
    .from('oauth_states')
    .update({ consumed_at: new Date().toISOString() })
    .eq('owner_id', ownerId)
    .eq('provider', provider)
    .eq('state_hash', stateHash)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .single();

  if (error || !data) {
    return false; // Already consumed, expired, or incorrect
  }
  return true; // Successfully consumed
}
`);

write('src/app/api/integrations/google/connect/route.ts', `
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createOAuthState } from '@/lib/oauthState';
import { OAuth2Client } from 'google-auth-library';
import { logAudit } from '@/lib/audit';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, 'Server configuration error');
    return NextResponse.redirect(new URL('/integrations?error=configuration_error', req.url));
  }

  const redirectUri = process.env.NEXT_PUBLIC_BASE_URL 
    ? \`\${process.env.NEXT_PUBLIC_BASE_URL}/api/integrations/google/callback\`
    : 'http://localhost:3000/api/integrations/google/callback';

  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

  const rawState = await createOAuthState(user.id, 'google');

  const authorizeUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/adwords'],
    state: rawState,
    prompt: 'consent'
  });

  await logAudit(user.id, 'OAUTH_CONNECT_STARTED', 'integration', null, null, null, 'Initiating Google OAuth');

  const response = NextResponse.redirect(authorizeUrl);
  
  const cookieStore = await cookies();
  cookieStore.set('oauth_state', rawState, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10
  });

  return response;
}
`);

write('src/app/api/integrations/google/callback/route.ts', `
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { OAuth2Client } from 'google-auth-library';
import { upsertIntegration, verifyGoogleConnection } from '@/lib/integrations';
import { logAudit } from '@/lib/audit';
import { withIdempotency } from '@/lib/idempotency';
import { consumeOAuthState } from '@/lib/oauthState';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/login?error=unauthorized', req.url));
  }

  if (errorParam) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, \`Provider error: \${errorParam}\`);
    return NextResponse.redirect(new URL('/integrations?error=provider_rejected', req.url));
  }

  // 1. Production Config Checks
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, 'Missing OAuth server configuration');
    return NextResponse.redirect(new URL('/integrations?error=configuration_error', req.url));
  }

  // 2. Cookie Transport State Check
  const cookieStore = await cookies();
  const storedState = cookieStore.get('oauth_state')?.value;
  cookieStore.delete('oauth_state'); // Clear transport

  if (!state || !storedState || state !== storedState) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, 'State transport mismatch / CSRF attempt');
    return NextResponse.redirect(new URL('/integrations?error=state_mismatch', req.url));
  }

  // 3. Database Atomic State Consumption
  const consumed = await consumeOAuthState(user.id, 'google', state);
  if (!consumed) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, 'State already consumed, expired, or invalid');
    return NextResponse.redirect(new URL('/integrations?error=state_mismatch', req.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/integrations?error=oauth_failed', req.url));
  }

  const redirectUri = process.env.NEXT_PUBLIC_BASE_URL 
    ? \`\${process.env.NEXT_PUBLIC_BASE_URL}/api/integrations/google/callback\`
    : 'http://localhost:3000/api/integrations/google/callback';

  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
  const idempotencyKey = \`oauth_google_\${state}\`;

  try {
    await withIdempotency(idempotencyKey, user.id, 'oauth_exchange', async () => {
      // In production, we ONLY use the real client.
      // Dependency injection / mocking for tests should not reside in the business logic branch.
      const { tokens } = await oauth2Client.getToken(code);

      const verification = await verifyGoogleConnection(tokens as any);
      
      if (!verification.safe) {
        await upsertIntegration(user.id, 'google', null, 'error', undefined, verification.reason);
        await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, \`Verification failed: \${verification.reason}\`);
        throw new Error('verification_failed'); // Safe error thrown to catch block
      }

      await upsertIntegration(user.id, 'google', tokens, 'connected', verification.accountId);
      
      await logAudit(user.id, 'OAUTH_CONNECTED', 'integration', null, null, null, 'Google OAuth successful');
      await logAudit(user.id, 'INTEGRATION_VERIFIED', 'integration', null, null, null, 'Google Ads connection verified');
      
      return true;
    });

    return NextResponse.redirect(new URL('/integrations?success=true', req.url));

  } catch (err: any) {
    // HARDENED ERROR RESPONSE
    // We log the detailed error internally, but output a safe generic URL error
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, \`Internal error: \${err.message}\`);
    return NextResponse.redirect(new URL('/integrations?error=oauth_failed', req.url));
  }
}
`);
console.log('OAuth fixes scaffolded.');
