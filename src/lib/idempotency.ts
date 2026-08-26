import { createClient } from './supabase/server';

export async function withIdempotency<T>(
  key: string,
  ownerId: string,
  resourceType: string,
  operation: () => Promise<T>,
  ttlMs: number = 60000
): Promise<T> {
  const supabase = await createClient();
  
  // 1. Try to lock (insert processing state)
  const { error: insertError } = await supabase.from('idempotency_keys').insert({
    id: key,
    owner_id: ownerId,
    resource_type: resourceType,
    status: 'processing'
  });

  if (insertError) {
    // 2. If it exists, check status and staleness
    const { data: existing } = await supabase
      .from('idempotency_keys')
      .select('*')
      .eq('id', key)
      .eq('owner_id', ownerId)
      .single();

    if (!existing) {
       throw new Error('Idempotency key collision with different owner or unknown error');
    }

    if (existing.status === 'completed') {
      return existing.response as T; // Cached response
    }

    if (existing.status === 'processing') {
      const lockAge = Date.now() - new Date(existing.updated_at).getTime();
      if (lockAge < ttlMs) {
         throw new Error('Concurrent request processing. Race protection triggered.');
      }
      // Stale lock recovery - we will proceed
    }
  }

  // 3. Execute
  try {
    const result = await operation();
    await supabase.from('idempotency_keys').upsert({
      id: key,
      owner_id: ownerId,
      resource_type: resourceType,
      status: 'completed',
      response: result as any,
      updated_at: new Date().toISOString()
    });
    return result;
  } catch (error: any) {
    await supabase.from('idempotency_keys').upsert({
      id: key,
      owner_id: ownerId,
      resource_type: resourceType,
      status: 'failed',
      response: { error: error.message },
      updated_at: new Date().toISOString()
    });
    throw error;
  }
}
