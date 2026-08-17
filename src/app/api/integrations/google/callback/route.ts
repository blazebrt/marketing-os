import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { OAuth2Client } from 'google-auth-library';
import { upsertIntegration, verifyGoogleConnection } from '@/lib/integrations';
import { logAudit } from '@/lib/audit';
import { withIdempotency } from '@/lib/idempotency';
import { cookies } from 'next/headers';

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

  if (errorParam) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, `Provider error: ${errorParam}`);
    return NextResponse.redirect(new URL('/integrations?error=provider_rejected', req.url));
  }

  // VALIDATE AND CONSUME STATE (Single-use enforcement)
  const cookieStore = await cookies();
  const storedState = cookieStore.get('oauth_state')?.value;
  
  // Immediately delete the cookie to prevent reuse
  cookieStore.delete('oauth_state');

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

  const idempotencyKey = `oauth_google_${state}`;

  try {
    await withIdempotency(idempotencyKey, user.id, 'oauth_exchange', async () => {
      let tokens;
      if (process.env.NODE_ENV === 'test' || clientId === 'mock_client_id') {
        tokens = { access_token: 'mock_access', refresh_token: 'mock_refresh' };
      } else {
        const { tokens: realTokens } = await oauth2Client.getToken(code);
        tokens = realTokens;
      }

      const verification = await verifyGoogleConnection(tokens as any);
      
      if (!verification.safe) {
        await upsertIntegration(user.id, 'google', null, 'error', undefined, verification.reason);
        await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, `Verification failed: ${verification.reason}`);
        throw new Error('Verification failed');
      }

      await upsertIntegration(user.id, 'google', tokens, 'connected', verification.accountId);
      
      await logAudit(user.id, 'OAUTH_CONNECTED', 'integration', null, null, null, 'Google OAuth successful');
      await logAudit(user.id, 'INTEGRATION_VERIFIED', 'integration', null, null, null, 'Google Ads connection verified');
      
      return true;
    });

    return NextResponse.redirect(new URL('/integrations?success=true', req.url));

  } catch (err: any) {
    return NextResponse.redirect(new URL(`/integrations?error=${encodeURIComponent(err.message)}`, req.url));
  }
}
