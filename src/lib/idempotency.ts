import { createClient } from './supabase/server';
import { createServiceClient } from './supabase/service';

async function idempotencyClient() {
  // Webhooks have no user JWT; service role is required to write the lock row.
  // Authenticated callers (OAuth) fall back to the session client in tests that
  // only mock createClient().
  try {
    return createServiceClient();
  } catch {
    return await createClient();
  }
}

function lockId(ownerId: string, key: string): string {
  return `${ownerId}:${key}`;
}

export async function withIdempotency<T>(
  key: string,
  ownerId: string,
  resourceType: string,
  operation: () => Promise<T>,
  ttlMs: number = 60000
): Promise<T> {
  const supabase = await idempotencyClient();
  const id = lockId(ownerId, key);

  const { error: insertError } = await supabase.from('idempotency_keys').insert({
    id,
    owner_id: ownerId,
    resource_type: resourceType,
    status: 'processing'
  });

  if (insertError) {
    const { data: existing } = await supabase
      .from('idempotency_keys')
      .select('*')
      .eq('id', id)
      .eq('owner_id', ownerId)
      .single();

    if (!existing) {
      throw new Error('Idempotency key collision with different owner or unknown error');
    }

    if (existing.status === 'completed') {
      return existing.response as T;
    }

    const staleBefore = new Date(Date.now() - ttlMs).toISOString();
    const now = new Date().toISOString();

    if (existing.status === 'processing') {
      const lockAge = Date.now() - new Date(existing.updated_at).getTime();
      if (lockAge < ttlMs) {
        throw new Error('Concurrent request processing. Race protection triggered.');
      }
      const { data: claimed } = await supabase
        .from('idempotency_keys')
        .update({ status: 'processing', updated_at: now, response: null })
        .eq('id', id)
        .eq('owner_id', ownerId)
        .eq('status', 'processing')
        .lt('updated_at', staleBefore)
        .select('id');
      if (!claimed || claimed.length === 0) {
        throw new Error('Concurrent request processing. Race protection triggered.');
      }
    } else if (existing.status === 'failed') {
      const { data: claimed } = await supabase
        .from('idempotency_keys')
        .update({ status: 'processing', updated_at: now, response: null })
        .eq('id', id)
        .eq('owner_id', ownerId)
        .eq('status', 'failed')
        .select('id');
      if (!claimed || claimed.length === 0) {
        throw new Error('Concurrent request processing. Race protection triggered.');
      }
    } else {
      throw new Error('Concurrent request processing. Race protection triggered.');
    }
  }

  try {
    const result = await operation();
    await supabase.from('idempotency_keys').upsert({
      id,
      owner_id: ownerId,
      resource_type: resourceType,
      status: 'completed',
      response: result as any,
      updated_at: new Date().toISOString()
    });
    return result;
  } catch (err) {
    await supabase.from('idempotency_keys').upsert({
      id,
      owner_id: ownerId,
      resource_type: resourceType,
      status: 'failed',
      response: { error: 'failed' },
      updated_at: new Date().toISOString()
    });
    throw err;
  }
}
