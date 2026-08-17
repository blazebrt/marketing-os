import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { OAuth2Client } from 'google-auth-library';
import { logAudit } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || 'mock_client_id';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || 'mock_client_secret';
  // Use exact callback route as requested
  const redirectUri = process.env.NEXT_PUBLIC_BASE_URL 
    ? `${process.env.NEXT_PUBLIC_BASE_URL}/api/integrations/google/callback`
    : 'http://localhost:3000/api/integrations/google/callback';

  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

  // Generate a secure random state for CSRF protection
  const state = require('crypto').randomBytes(32).toString('hex');

  const authorizeUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/adwords'],
    state,
    prompt: 'consent'
  });

  // Log audit
  await logAudit(user.id, 'OAUTH_CONNECT_STARTED', 'integration', null, null, null, 'Google Ads connection started');

  // Store state in HTTP-only cookie
  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600 // 10 mins
  });

  return response;
}
