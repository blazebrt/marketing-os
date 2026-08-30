import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // refreshing the auth token and checking access
  const { data: { user } } = await supabase.auth.getUser();

  // Only these API paths are callable without a session. Everything else under
  // /api still authenticates inside the route; this is defense in depth so a
  // new route cannot ship accidentally unauthenticated at the edge.
  const pathname = request.nextUrl.pathname;
  const isPublicRoute =
    pathname.startsWith('/login') ||
    pathname === '/api/leads' ||
    pathname === '/api/interactions' ||
    pathname.startsWith('/api/cron/') ||
    pathname.startsWith('/api/integrations/google/callback');
  
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return supabaseResponse
}
