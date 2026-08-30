import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { OAuth2Client } from 'google-auth-library';
import { upsertIntegration, verifyGoogleConnection } from '@/lib/integrations';
import { logAudit } from '@/lib/audit';
import { withIdempotency } from '@/lib/idempotency';
import { consumeOAuthState } from '@/lib/oauthState';
import { appOrigin, appUrl } from '@/lib/appUrl';
import { cookies } from 'next/headers';

function statesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (left.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(left, bBuf);
}

function clearOauthCookie(response: NextResponse) {
  response.cookies.set('oauth_state', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return clearOauthCookie(NextResponse.redirect(appUrl('/login?error=unauthorized', req.url)));
  }

  if (errorParam) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, `Provider error: ${errorParam}`);
    return clearOauthCookie(NextResponse.redirect(appUrl('/integrations?error=provider_rejected', req.url)));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, 'Missing OAuth server configuration');
    return clearOauthCookie(NextResponse.redirect(appUrl('/integrations?error=configuration_error', req.url)));
  }

  const cookieStore = await cookies();
  const storedState = req.cookies.get('oauth_state')?.value || cookieStore.get('oauth_state')?.value;

  if (!state || !storedState || !statesMatch(state, storedState)) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, 'State transport mismatch / CSRF attempt');
    return clearOauthCookie(NextResponse.redirect(appUrl('/integrations?error=state_mismatch', req.url)));
  }

  const consumed = await consumeOAuthState(user.id, 'google', state);
  if (!consumed) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, 'State already consumed, expired, or invalid');
    return clearOauthCookie(NextResponse.redirect(appUrl('/integrations?error=state_mismatch', req.url)));
  }

  if (!code) {
    return clearOauthCookie(NextResponse.redirect(appUrl('/integrations?error=oauth_failed', req.url)));
  }

  const redirectUri = `${appOrigin(req.url)}/api/integrations/google/callback`;

  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
  const idempotencyKey = `oauth_google_${state}`;

  try {
    await withIdempotency(idempotencyKey, user.id, 'oauth_exchange', async () => {
      const { tokens } = await oauth2Client.getToken(code);

      const verification = await verifyGoogleConnection(tokens as any);
      
      if (!verification.safe) {
        await upsertIntegration(user.id, 'google', null, 'error', undefined, verification.reason);
        await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, `Verification failed: ${verification.reason}`);
        throw new Error('verification_failed');
      }

      await upsertIntegration(user.id, 'google', tokens, 'connected', verification.accountId);
      
      await logAudit(user.id, 'OAUTH_CONNECTED', 'integration', null, null, null, 'Google OAuth successful');
      await logAudit(user.id, 'INTEGRATION_VERIFIED', 'integration', null, null, null, 'Google Ads connection verified');
      
      return true;
    });

    return clearOauthCookie(NextResponse.redirect(appUrl('/integrations?success=true', req.url)));

  } catch {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, 'OAUTH_INTERNAL_ERROR');
    return clearOauthCookie(NextResponse.redirect(appUrl('/integrations?error=oauth_failed', req.url)));
  }
}
