import { NextRequest } from 'next/server';
import { appOrigin } from '@/lib/appUrl';

/**
 * Cookie-authenticated POST routes must not accept a cross-site form
 * (SameSite=Lax still sends cookies on top-level POSTs).
 */
export function mutationOriginAllowed(req: NextRequest): boolean {
  let expected: string;
  try {
    expected = appOrigin(req.url);
  } catch {
    return false;
  }

  const origin = req.headers.get('origin');
  if (origin) return origin === expected;

  const referer = req.headers.get('referer');
  if (!referer) return false;
  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
}
