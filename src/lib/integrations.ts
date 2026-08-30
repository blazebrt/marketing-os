import { createClient } from './supabase/server';
import { createServiceClient } from './supabase/service';
import { encryptCredential } from './crypto';
import { OAuth2Client } from 'google-auth-library';
import { logAudit } from './audit';

const ENCRYPT_CREDENTIAL_FIELDS = new Set(['access_token', 'refresh_token', 'hmac_secret']);
const PLAIN_CREDENTIAL_FIELDS = new Set(['expiry_date', 'token_type', 'scope']);

/** Persist only known OAuth/webhook fields; encrypt token secrets. */
export function sanitiseIntegrationCredentials(credentials: unknown): Record<string, unknown> | null {
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
    return null;
  }
  const src = credentials as Record<string, unknown>;
  const out: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(src)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
    if (ENCRYPT_CREDENTIAL_FIELDS.has(key)) {
      if (typeof value === 'string' && value.length > 0 && value.length <= 8192) {
        out[key] = encryptCredential(value);
      }
      continue;
    }
    if (!PLAIN_CREDENTIAL_FIELDS.has(key)) continue;
    if (key === 'expiry_date' && (typeof value === 'number' || typeof value === 'string')) {
      out[key] = value;
    } else if (typeof value === 'string' && value.length > 0 && value.length <= 512) {
      out[key] = value;
    }
  }
  return out;
}

export async function verifyGoogleConnection(tokens: { access_token: string, refresh_token?: string }): Promise<{ safe: boolean; reason?: string; accountId?: string }> {
  if (!tokens.access_token) return { safe: false, reason: 'Missing access token' };

  try {
    const client = new OAuth2Client();
    client.setCredentials(tokens);

    // Verify token validity. Throws if invalid/expired.
    await client.getTokenInfo(tokens.access_token);
    
    // We do not require tokenInfo.email. Google Ads uses Manager/Customer IDs.
    // Return safe: true without accountId. The identity will be resolved later.
    return { safe: true }; 
  } catch (e: any) {
    return { safe: false, reason: 'Invalid or expired OAuth token' };
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
  }, { onConflict: 'owner_id,provider' });

  if (metaError) throw metaError;

  // 2. Insert Credentials securely to server-only table
  if (credentials) {
    const safeCreds = sanitiseIntegrationCredentials(credentials);
    if (!safeCreds) throw new Error('Invalid credentials');

    const { error: credError } = await serviceClient.from('integration_credentials').upsert({
      owner_id: ownerId,
      provider,
      encrypted_credentials: JSON.stringify(safeCreds),
      updated_at: new Date().toISOString()
    }, { onConflict: 'owner_id,provider' });

    if (credError) throw credError;
  }
}

export async function disconnectIntegration(ownerId: string, provider: string) {
  if (!['meta', 'google', 'whatsapp', 'instagram', 'website'].includes(provider)) {
    throw new Error('Unknown provider');
  }
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

  await logAudit(ownerId, 'INTEGRATION_DISCONNECTED', 'integration', null, null, null, `Disconnected ${provider}`);
}
