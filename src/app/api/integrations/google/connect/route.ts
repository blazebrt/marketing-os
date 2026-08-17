import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createOAuthState } from '@/lib/oauthState';
import { OAuth2Client } from 'google-auth-library';
import { logAudit } from '@/lib/audit';
import { cookies } from 'next/headers';

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
    return NextResponse.redirect(new URL('/integrations?error=configuration_error', req.url));
  }

  const redirectUri = process.env.NEXT_PUBLIC_BASE_URL 
    ? `${process.env.NEXT_PUBLIC_BASE_URL}/api/integrations/google/callback`
    : 'http://localhost:3000/api/integrations/google/callback';

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
  
  const cookieStore = await cookies();
  cookieStore.set('oauth_state', rawState, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10
  });

  return response;
}
