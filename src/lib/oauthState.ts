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
