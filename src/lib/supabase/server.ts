import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export let __MockCreateClient: any = null;
export function __setMockCreateClient(mock: any) { __MockCreateClient = mock; }

export async function createClient() {
  if (__MockCreateClient) return __MockCreateClient();
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}
