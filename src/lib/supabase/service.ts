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
