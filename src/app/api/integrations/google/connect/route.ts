import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createOAuthState } from '@/lib/oauthState';
import { OAuth2Client } from 'google-auth-library';
import { logAudit } from '@/lib/audit';
import { appOrigin, appUrl } from '@/lib/appUrl';

const OAUTH_COOKIE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 60 * 10,
  path: '/',
};

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    await logAudit(user.id, 'OAUTH_FAILED', 'integration', null, null, null, 'Server configuration error');
    return NextResponse.redirect(appUrl('/integrations?error=configuration_error', req.url));
  }

  const redirectUri = `${appOrigin(req.url)}/api/integrations/google/callback`;

  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

  const rawState = await createOAuthState(user.id, 'google');

  const authorizeUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/adwords'],
    state: rawState,
    prompt: 'consent'
  });

  await logAudit(user.id, 'OAUTH_CONNECT_STARTED', 'integration', null, null, null, 'Initiating Google OAuth');

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set('oauth_state', rawState, OAUTH_COOKIE);
  return response;
}
