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

  await logAudit(ownerId, 'INTEGRATION_DISCONNECTED', 'integration', null, null, null, `Disconnected ${provider}`);
}
