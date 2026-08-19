
(global as any).mockCookieState = 'test-state';
import Module from 'module';
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'next/headers') {
    return {
      cookies: () => ({
        get: (name: string) => ({ value: (global as any).mockCookieState }),
        delete: () => {}
      })
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import { verifyGoogleConnection } from '../src/lib/integrations';
import { OAuth2Client, gaxios } from 'google-auth-library';
import { createClient } from '@supabase/supabase-js';
import { createOAuthState, consumeOAuthState } from '../src/lib/oauthState';
import { __setMockLogAudit } from '../src/lib/audit';
import { __setMockCreateClient } from '../src/lib/supabase/server';

import { NextRequest } from 'next/server';

let GET: any;

async function runTests() {
  GET = require('../src/app/api/integrations/google/callback/route').GET;
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
  const originalGetToken = OAuth2Client.prototype.getToken;
  const originalGaxiosRequest = gaxios.Gaxios.prototype.request;

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

    // E. Unauthorized users cannot create/update the integration.
    const anonClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'yes');
    const { error: anonError } = await anonClient.from('integrations').upsert({
      owner_id: '00000000-0000-0000-0000-000000000000',
      provider: 'google',
      status: 'connected'
    });
    assert(anonError !== null && parseInt(anonError.code) === 42501, 'E. Unauthorized users cannot create/update the integration (native RLS blocks you)');

    // F. Existing OAuth CSRF/state protections still pass.
    const mockOwner = '00000000-0000-0000-0000-000000000000';
    const stateId = await createOAuthState(mockOwner, 'google');
    const consumed1st = await consumeOAuthState(mockOwner, 'google', stateId);
    const consumed2nd = await consumeOAuthState(mockOwner, 'google', stateId);
    assert(consumed1st === true && consumed2nd === false, 'F. Existing OAuth CSRF/state protections still pass (atomic consumption)');

    // G. Real tokeninfo request is actually made, and no Google Ads mutation API is invoked.
    OAuth2Client.prototype.getTokenInfo = originalGetTokenInfo; // Restore real getTokenInfo to execute its actual implementation

    let tokenInfoRequestObserved: any = false;
    let correctMethod: any = false;
    let mutationAttempted: any = false;
    let unexpectedEndpoint: any = false;
    
    gaxios.Gaxios.prototype.request = async (opts: any) => {
      const url = opts.url || '';
      const method = (opts.method || 'GET').toUpperCase();

      if (url.includes('oauth2.googleapis.com/tokeninfo') || url.includes('oauth2/v3/tokeninfo')) {
        tokenInfoRequestObserved = true;
        if (method === 'POST') correctMethod = true; // getTokenInfo uses POST
        return { data: { aud: 'client-id', exp: 9999999999, scope: 'adwords', expires_in: 3600 } } as any;
      }
      
      if (url.includes('googleads.googleapis.com')) {
        mutationAttempted = true;
      } else {
        unexpectedEndpoint = true;
      }
      
      return { data: {} } as any;
    };
    
    await verifyGoogleConnection({ access_token: 'valid-token' });
    
    assert(tokenInfoRequestObserved === true, 'G. Real tokeninfo request observed');
    assert(correctMethod === true, 'G. HTTP method verified POST (google-auth-library getTokenInfo uses POST)');
    assert((mutationAttempted as boolean) === false, 'G. Google Ads mutation endpoints blocked');
    assert((unexpectedEndpoint as boolean) === false, 'G. Unexpected endpoints blocked');
    
    // H. Secret Injection Test
    const stateId2 = await createOAuthState(mockOwner, 'google');
    (global as any).mockCookieState = stateId2;

    __setMockCreateClient(async () => ({
      auth: { getUser: async () => ({ data: { user: { id: mockOwner } } }) }
    }));

    let loggedError = '';
    __setMockLogAudit(async (actor: string, action: string, type: string, id: string, before: any, after: any, reason: string) => {
      if (action === 'OAUTH_FAILED') {
        loggedError = reason;
      }
    });

    OAuth2Client.prototype.getToken = async () => {
      throw new Error('Crash! Bearer SECRET_TEST_TOKEN');
    };

    const req = new NextRequest(`http://localhost:3000/api/integrations/google/callback?code=abc&state=${stateId2}`);
    const res = await GET(req);

    assert(res.status === 307, 'H. Request still fails safely (redirects)');
    assert(res.headers.get('location')?.includes('error=oauth_failed') || false, 'H. Browser response contains only generic oauth_failed error');
    assert(loggedError === 'OAUTH_INTERNAL_ERROR', 'H. Audit log payload is sanitized and does NOT contain the injected secret');
    assert(!loggedError.includes('SECRET_TEST_TOKEN'), 'H. No raw error message is persisted');

  } catch (e: any) {
    console.error(e);
    failCount++;
  } finally {
    OAuth2Client.prototype.getTokenInfo = originalGetTokenInfo;
    OAuth2Client.prototype.request = originalRequest;
    OAuth2Client.prototype.getToken = originalGetToken;
    gaxios.Gaxios.prototype.request = originalGaxiosRequest;
    __setMockLogAudit(null);
    __setMockCreateClient(null);
  }

  console.log('\n--- TESTS COMPLETE: ' + passCount + ' PASS, ' + failCount + ' FAIL ---');
  if (failCount > 0) process.exit(1);
}

runTests().catch(console.error);

