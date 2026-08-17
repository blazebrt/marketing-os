import { createClient } from './supabase/server';

export async function withIdempotency<T>(
  key: string,
  actor: string,
  requestPath: string,
  operation: () => Promise<T>
): Promise<T> {
  const supabase = await createClient();

  // 1. Try to lock the key
  const { data: existingKey, error: fetchError } = await supabase
    .from('idempotency_keys')
    .select('*')
    .eq('key', key)
    .single();

  if (existingKey) {
    if (existingKey.completed_at) {
      // Return cached response
      return existingKey.response_body as T;
    } else {
      throw new Error('Operation is already in progress.');
    }
  }

  // 2. Insert new key (lock)
  const { error: insertError } = await supabase
    .from('idempotency_keys')
    .insert({
      key,
      actor,
      request_path: requestPath,
      locked_at: new Date().toISOString(),
    });

  if (insertError) {
    throw new Error('Failed to acquire idempotency lock. Potential concurrent request.');
  }

  // 3. Execute the operation
  try {
    const result = await operation();

    // 4. Cache the result
    await supabase
      .from('idempotency_keys')
      .update({
        response_body: result as any,
        response_status: 200,
        completed_at: new Date().toISOString(),
      })
      .eq('key', key);

    return result;
  } catch (error: any) {
    // Release lock on failure so it can be retried safely
    await supabase
      .from('idempotency_keys')
      .delete()
      .eq('key', key);
    
    throw error;
  }
}
