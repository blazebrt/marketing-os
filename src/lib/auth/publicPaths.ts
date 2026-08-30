/**
 * Paths the edge proxy may serve without a session.
 * Keep this exact: a prefix like /login would also open /loginfoo.
 */
export function isUnauthenticatedPublicPath(pathname: string): boolean {
  if (pathname === '/login' || pathname.startsWith('/login/')) return true;
  if (pathname === '/api/leads' || pathname === '/api/leads/') return true;
  if (pathname === '/api/interactions' || pathname === '/api/interactions/') return true;
  if (pathname.startsWith('/api/cron/')) return true;
  if (
    pathname === '/api/integrations/google/callback' ||
    pathname.startsWith('/api/integrations/google/callback/')
  ) {
    return true;
  }
  return false;
}
