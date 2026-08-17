import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { OAuth2Client } from 'google-auth-library';
import { upsertIntegration, verifyGoogleConnection } from '@/lib/integrations';
import { logAudit } from '@/lib/audit';
import { withIdempotency } from '@/lib/idempotency';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 1. Error from Provider
  if (errorParam) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, `Provider error: ${errorParam}`);
    return NextResponse.redirect(new URL('/integrations?error=provider_rejected', req.url));
  }

  // 2. Validate State (CSRF)
  const storedState = req.cookies.get('oauth_state')?.value;
  if (!state || state !== storedState) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, 'State mismatch / CSRF attempt');
    return NextResponse.redirect(new URL('/integrations?error=state_mismatch', req.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/integrations?error=missing_code', req.url));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || 'mock_client_id';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || 'mock_client_secret';
  const redirectUri = process.env.NEXT_PUBLIC_BASE_URL 
    ? `${process.env.NEXT_PUBLIC_BASE_URL}/api/integrations/google/callback`
    : 'http://localhost:3000/api/integrations/google/callback';

  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

  // 3. Idempotent Code Exchange
  const idempotencyKey = `oauth_google_${state}`;

  try {
    await withIdempotency(idempotencyKey, user.id, 'oauth_exchange', async () => {
      // Exchange code for tokens
      let tokens;
      if (process.env.NODE_ENV === 'test' || clientId === 'mock_client_id') {
        // Mock exchange for test environments without real Google credentials
        tokens = { access_token: 'mock_access', refresh_token: 'mock_refresh' };
      } else {
        const { tokens: realTokens } = await oauth2Client.getToken(code);
        tokens = realTokens;
      }

      // Verify connection (fail-closed)
      const verification = await verifyGoogleConnection(tokens as any);
      
      if (!verification.safe) {
        await upsertIntegration(user.id, 'google', null, 'error');
        await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, `Verification failed: ${verification.reason}`);
        throw new Error('Verification failed');
      }

      // Secure storage
      await upsertIntegration(user.id, 'google', tokens, 'connected');
      
      await logAudit(user.id, 'OAUTH_CONNECTED', 'integration', null, null, null, 'Google OAuth successful');
      await logAudit(user.id, 'INTEGRATION_VERIFIED', 'integration', null, null, null, 'Google Ads connection verified');
      
      return true;
    });

    const response = NextResponse.redirect(new URL('/integrations?success=true', req.url));
    response.cookies.delete('oauth_state');
    return response;

  } catch (err: any) {
    return NextResponse.redirect(new URL(`/integrations?error=${encodeURIComponent(err.message)}`, req.url));
  }
}
