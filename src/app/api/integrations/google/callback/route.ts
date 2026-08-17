import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { OAuth2Client } from 'google-auth-library';
import { upsertIntegration, verifyGoogleConnection } from '@/lib/integrations';
import { logAudit } from '@/lib/audit';
import { withIdempotency } from '@/lib/idempotency';
import { consumeOAuthState } from '@/lib/oauthState';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/login?error=unauthorized', req.url));
  }

  if (errorParam) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, `Provider error: ${errorParam}`);
    return NextResponse.redirect(new URL('/integrations?error=provider_rejected', req.url));
  }

  // 1. Production Config Checks
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, 'Missing OAuth server configuration');
    return NextResponse.redirect(new URL('/integrations?error=configuration_error', req.url));
  }

  // 2. Cookie Transport State Check
  const cookieStore = await cookies();
  const storedState = cookieStore.get('oauth_state')?.value;
  cookieStore.delete('oauth_state'); // Clear transport

  if (!state || !storedState || state !== storedState) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, 'State transport mismatch / CSRF attempt');
    return NextResponse.redirect(new URL('/integrations?error=state_mismatch', req.url));
  }

  // 3. Database Atomic State Consumption
  const consumed = await consumeOAuthState(user.id, 'google', state);
  if (!consumed) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, 'State already consumed, expired, or invalid');
    return NextResponse.redirect(new URL('/integrations?error=state_mismatch', req.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/integrations?error=oauth_failed', req.url));
  }

  const redirectUri = process.env.NEXT_PUBLIC_BASE_URL 
    ? `${process.env.NEXT_PUBLIC_BASE_URL}/api/integrations/google/callback`
    : 'http://localhost:3000/api/integrations/google/callback';

  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
  const idempotencyKey = `oauth_google_${state}`;

  try {
    await withIdempotency(idempotencyKey, user.id, 'oauth_exchange', async () => {
      // In production, we ONLY use the real client.
      // Dependency injection / mocking for tests should not reside in the business logic branch.
      const { tokens } = await oauth2Client.getToken(code);

      const verification = await verifyGoogleConnection(tokens as any);
      
      if (!verification.safe) {
        await upsertIntegration(user.id, 'google', null, 'error', undefined, verification.reason);
        await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, `Verification failed: ${verification.reason}`);
        throw new Error('verification_failed'); // Safe error thrown to catch block
      }

      await upsertIntegration(user.id, 'google', tokens, 'connected', verification.accountId);
      
      await logAudit(user.id, 'OAUTH_CONNECTED', 'integration', null, null, null, 'Google OAuth successful');
      await logAudit(user.id, 'INTEGRATION_VERIFIED', 'integration', null, null, null, 'Google Ads connection verified');
      
      return true;
    });

    return NextResponse.redirect(new URL('/integrations?success=true', req.url));

  } catch (err: any) {
    // HARDENED ERROR RESPONSE
    // We log the detailed error internally, but output a safe generic URL error
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, `Internal error: ${err.message}`);
    return NextResponse.redirect(new URL('/integrations?error=oauth_failed', req.url));
  }
}
