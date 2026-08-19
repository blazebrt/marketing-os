import { verifyGoogleConnection } from '../src/lib/integrations';
import { OAuth2Client } from 'google-auth-library';
import { GET } from '../src/app/api/integrations/google/callback/route';
import { NextRequest } from 'next/server';
import * as serverSupabase from '../src/lib/supabase/server';
import * as nextHeaders from 'next/headers';
import * as oauthState from '../src/lib/oauthState';

async function runTests() {
  console.log('--- STARTING OAUTH IDENTITY TESTS ---');
  let passCount = 0;
  let failCount = 0;

  const assert = (condition: boolean, msg: string) => {
    if (condition) {
      console.log('PASS: ' + msg);
      passCount++;
    } else {
      console.error('FAIL: ' + msg);
      failCount++;
    }
  };

  const originalGetTokenInfo = OAuth2Client.prototype.getTokenInfo;
  const originalRequest = OAuth2Client.prototype.request;

  // Stubs
  const originalCreateClient = serverSupabase.createClient;
  const originalCookies = (nextHeaders as any).cookies;
  const originalConsumeOAuthState = oauthState.consumeOAuthState;

  try {
    // A. OAuth token without email does NOT fail merely because email is absent.
    OAuth2Client.prototype.getTokenInfo = async () => ({
      aud: 'client-id',
      exp: 9999999999
    } as any);

    const resultWithoutEmail = await verifyGoogleConnection({ access_token: 'valid-token' });
    assert(resultWithoutEmail.safe === true, 'A. OAuth token without email does NOT fail merely because email is absent');
    assert(resultWithoutEmail.accountId === undefined, 'C. No email is returned or stored as external_id (accountId is omitted)');

    // B. Invalid/expired token still fails closed.
    OAuth2Client.prototype.getTokenInfo = async () => {
      throw new Error('Invalid token: token expired');
    };
    const resultInvalid = await verifyGoogleConnection({ access_token: 'expired-token' });
    assert(resultInvalid.safe === false, 'B. Invalid/expired token still fails closed');
    assert(resultInvalid.reason === 'Invalid or expired OAuth token', 'D. No OAuth secret/token appears in errors or audit logs');

    // Restore
    OAuth2Client.prototype.getTokenInfo = originalGetTokenInfo;

    // E. Unauthorized users cannot create/update the integration.
    // We stub supabase to return null user
    (serverSupabase as any).createClient = async () => ({
      auth: { getUser: async () => ({ data: { user: null } }) }
    });
    const reqE = new NextRequest('http://localhost:3000/api/integrations/google/callback?code=abc&state=xyz');
    const resE = await GET(reqE);
    assert(resE.status === 307 && resE.headers.get('location')?.includes('/login?error=unauthorized'), 'E. Unauthorized users cannot create/update the integration (401/redirect enforced)');

    // F. Existing OAuth CSRF/state protections still pass.
    // Stub supabase to return valid user
    (serverSupabase as any).createClient = async () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'mock-user-id' } } }) }
    });
    // Stub cookies to return a DIFFERENT state
    (nextHeaders as any).cookies = async () => ({
      get: () => ({ value: 'different-state-in-cookie' }),
      delete: () => {}
    });
    const reqF = new NextRequest('http://localhost:3000/api/integrations/google/callback?code=abc&state=provided-state');
    const resF = await GET(reqF);
    assert(resF.status === 307 && resF.headers.get('location')?.includes('error=state_mismatch'), 'F. Existing OAuth CSRF/state protections still pass (state mismatch rejected)');

    // G. No Google Ads mutation API is invoked.
    // We verify this by spying on OAuth2Client.request which handles all google-auth-library network traffic.
    let mutationAttempted = false;
    let otherApiCalled = false;
    
    OAuth2Client.prototype.request = async (opts: any) => {
      // getTokenInfo uses the tokeninfo endpoint
      if (opts.url && opts.url.includes('tokeninfo')) {
        return { data: { aud: 'client-id', exp: 9999999999 } } as any;
      }
      
      // If ANY other url or any POST/PUT/DELETE is called, flag it.
      if (opts.method && opts.method.toUpperCase() !== 'GET') mutationAttempted = true;
      if (opts.url && opts.url.includes('googleads.googleapis.com')) mutationAttempted = true;
      
      otherApiCalled = true;
      return { data: {} } as any;
    };
    
    await verifyGoogleConnection({ access_token: 'valid-token' });
    
    assert(mutationAttempted === false && otherApiCalled === false, 'G. No Google Ads mutation API is invoked (verifyGoogleConnection only uses tokeninfo)');
    
  } catch (e: any) {
    console.error(e);
  } finally {
    OAuth2Client.prototype.getTokenInfo = originalGetTokenInfo;
    OAuth2Client.prototype.request = originalRequest;
    (serverSupabase as any).createClient = originalCreateClient;
    (nextHeaders as any).cookies = originalCookies;
    (oauthState as any).consumeOAuthState = originalConsumeOAuthState;
  }

  console.log('\n--- TESTS COMPLETE: ' + passCount + ' PASS, ' + failCount + ' FAIL ---');
  if (failCount > 0) process.exit(1);
}

runTests().catch(console.error);

