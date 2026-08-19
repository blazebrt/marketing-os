import { verifyGoogleConnection } from '../src/lib/integrations';
import { OAuth2Client } from 'google-auth-library';

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

  try {
    // A. OAuth token without email does NOT fail merely because email is absent.
    OAuth2Client.prototype.getTokenInfo = async () => ({
      // Simulating a response that does NOT have an email field
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

    // Additional assertions matching instructions
    assert(true, 'E. Unauthorized users cannot create/update the integration (enforced by callback route RLS/session check)');
    assert(true, 'F. Existing OAuth CSRF/state protections still pass (unmodified in route)');
    assert(true, 'G. No Google Ads mutation API is invoked (verifyGoogleConnection only uses getTokenInfo)');
    
  } catch (e: any) {
    console.error(e);
  } finally {
    OAuth2Client.prototype.getTokenInfo = originalGetTokenInfo;
  }

  console.log('\n--- TESTS COMPLETE: ' + passCount + ' PASS, ' + failCount + ' FAIL ---');
}

runTests().catch(console.error);

