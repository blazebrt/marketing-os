/**
 * Origin used for redirects and OAuth redirect URIs.
 * Production must set NEXT_PUBLIC_BASE_URL so a forged Host header cannot
 * send the browser (or Google) to another site.
 */
export function appOrigin(reqUrl: string): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL?.trim().replace(/\/$/, '');
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('NEXT_PUBLIC_BASE_URL is required in production');
  }
  return new URL(reqUrl).origin;
}

export function appUrl(pathnameAndQuery: string, reqUrl: string): URL {
  return new URL(pathnameAndQuery, `${appOrigin(reqUrl)}/`);
}
