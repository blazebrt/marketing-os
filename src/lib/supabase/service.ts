import { createClient } from '@supabase/supabase-js';

export let __MockServiceClient: any = null;
export function __setMockServiceClient(mock: any) { __MockServiceClient = mock; }

export function createServiceClient() {
  if (__MockServiceClient) return __MockServiceClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !serviceRoleKey) {
    throw new Error('Missing Supabase Service Role credentials');
  }
  
  return createClient(url, serviceRoleKey);
}
