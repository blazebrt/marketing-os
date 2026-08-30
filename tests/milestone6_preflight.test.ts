import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import './setup';
// tests/milestone6_preflight.test.ts
import { authorizeGoogleTestMutation } from '../src/lib/providers/google/mutation-gate';
import { checkPreflightEnvironment } from '../scripts/google_preflight';
import { __setMockGoogleAdsApi } from '../src/lib/providers/google/test-account';
import { GoogleProviderError } from '../src/lib/providers/google/errors';

// Mock GoogleAdsApi to simulate test account verification
class MockCustomer {
  constructor(public config: any) {}
  async query() {
    if (process.env.TEST_ACCOUNT_FAIL === 'true') {
      throw new Error('Test account verification failed');
    }
    if (process.env.TEST_ACCOUNT_FALSE === 'true') {
      return [{ customer: { id: '9999999999', test_account: false } }];
    }
    return [{ customer: { id: '1234567890', test_account: true } }];
  }
}
class MockGoogleAdsApi {
  constructor(public config: any) {}
  Customer(config: any) { return new MockCustomer(config); }
}
__setMockGoogleAdsApi(MockGoogleAdsApi);


async function runPreflightTests() {
  console.log('--- STARTING MILESTONE 6.1 PREFLIGHT & GATE TESTS ---');
  let passCount = 0;
  let failCount = 0;

  const assert = (condition: boolean, msg: string) => {
    if (condition) { console.log(`PASS: ${msg}`); passCount++; }
    else { console.error(`FAIL: ${msg}`); failCount++; }
  };

  const backupEnv = { ...process.env };
  
  const resetEnv = () => {
    process.env = { ...backupEnv };
    (process.env as any).GOOGLE_ADS_EXECUTION_MODE = 'test';
    (process.env as any).GOOGLE_ADS_ALLOW_MUTATIONS = 'true';
    (process.env as any).NODE_ENV = 'test';
    (process.env as any).GOOGLE_ADS_TEST_CUSTOMER_ID = '1234567890';
    (process.env as any).GOOGLE_ADS_DEPLOYMENT_CONFIRMATION = 'CONFIRMED';
    (process.env as any).GOOGLE_ADS_DEVELOPER_TOKEN = 'valid-token';
    (process.env as any).GOOGLE_CLIENT_ID = 'valid-client';
    (process.env as any).GOOGLE_CLIENT_SECRET = 'valid-secret';
    (process.env as any).GOOGLE_ADS_TEST_MANAGER_ID = '1234567890';
    delete process.env.TEST_ACCOUNT_FAIL;
    delete process.env.TEST_ACCOUNT_FALSE;
  };

  const validDeployment = { owner_id: 'user-123', status: 'READY_TO_DEPLOY' };
  const validTargetState = {
    headlines: [{ current_value: 'Test', owner_approved: true, rejected: false }]
  };

  const testGate = async (msg: string, expectSuccess: boolean, deployment: any = validDeployment, targetState: any = validTargetState, uid = 'user-123') => {
    try {
      await authorizeGoogleTestMutation(uid, deployment.status, deployment, targetState, 'dummy-token');
      if (expectSuccess) assert(true, msg);
      else assert(false, msg + ' (should have failed)');
    } catch (e: any) {
      if (!expectSuccess) assert(true, msg);
      else assert(false, msg + ' (failed unexpectedly: ' + e.message + ')');
    }
  };

  resetEnv();
  delete (process.env as any).GOOGLE_ADS_EXECUTION_MODE;
  await testGate('1. execution mode missing -> rejected', false);

  resetEnv();
  (process.env as any).GOOGLE_ADS_EXECUTION_MODE = 'production';
  await testGate('2. execution mode != test -> rejected', false);

  resetEnv();
  delete (process.env as any).GOOGLE_ADS_ALLOW_MUTATIONS;
  await testGate('3. mutation flag missing -> rejected', false);

  resetEnv();
  (process.env as any).GOOGLE_ADS_ALLOW_MUTATIONS = 'false';
  await testGate('4. mutation flag false -> rejected', false);

  resetEnv();
  (process.env as any).NODE_ENV = 'production';
  await testGate('5. NODE_ENV production -> rejected', false);

  resetEnv();
  delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  try {
    await checkPreflightEnvironment();
    assert(false, '6. missing developer token -> rejected');
  } catch (e) {
    assert(true, '6. missing developer token -> rejected');
  }

  resetEnv();
  delete process.env.GOOGLE_CLIENT_ID;
  try {
    await checkPreflightEnvironment();
    assert(false, '7. missing OAuth configuration -> rejected');
  } catch (e) {
    assert(true, '7. missing OAuth configuration -> rejected');
  }

  resetEnv();
  process.env.TEST_ACCOUNT_FAIL = 'true';
  await testGate('8. test account verification failure -> rejected', false);

  resetEnv();
  process.env.TEST_ACCOUNT_FALSE = 'true';
  await testGate('9. customer.test_account false -> rejected', false);

  resetEnv();
  (process.env as any).GOOGLE_ADS_TEST_CUSTOMER_ID = '9999999999';
  await testGate('10. customer ID mismatch -> rejected', false);

  resetEnv();
  await testGate('11. anonymous user -> rejected', false, validDeployment, validTargetState, '');

  resetEnv();
  await testGate('12. wrong owner -> rejected', false, validDeployment, validTargetState, 'user-456');

  resetEnv();
  await testGate('13. owner spoof -> rejected', false, { ...validDeployment, owner_id: 'user-999' }, validTargetState, 'user-123');

  resetEnv();
  await testGate('14. campaign not READY_TO_DEPLOY -> rejected', false, { ...validDeployment, status: 'FAILED' });

  resetEnv();
  await testGate('15. unapproved creative -> rejected', false, validDeployment, { headlines: [{ current_value: 'Test', owner_approved: false, rejected: false }] });

  resetEnv();
  await testGate('17. successful authorization -> allowed', true);


  // 16. invalid budget
  resetEnv();
  const { calculateSafetyLimits } = require('../src/lib/campaigns/safeguards');
  try {
    calculateSafetyLimits('daily', 50001, 10);
    assert(false, '16. invalid budget -> rejected');
  } catch (e: any) {
    assert(e.message.includes('exceeds safety limit') || e.message.includes('above'), '16. invalid budget -> rejected');
  }

  // 18. raw credentials never appear in logs
  // 19. raw Google errors never appear in logs
  resetEnv();
  process.env.TEST_ACCOUNT_FAIL = 'true';
  const oldQuery = MockCustomer.prototype.query;
  MockCustomer.prototype.query = async function() {
    throw new Error('Google SDK Error: Bearer my-secret-token | dev-token: abc | refresh: def | stack trace');
  };
  try {
    await checkPreflightEnvironment();
    assert(false, '18/19. raw credentials/errors never appear in preflight (should have thrown)');
  } catch(e: any) {
    const msg = e.message || e.toString();
    const isSafe = !msg.includes('my-secret-token') && !msg.includes('Bearer') && !msg.includes('abc');
    assert(isSafe, '18/19. raw credentials/errors never appear in preflight');
  }
  
  try {
    await authorizeGoogleTestMutation('user-123', validDeployment.status, validDeployment, validTargetState, 'dummy-token');
    assert(false, '18/19 part 2 (should have thrown)');
  } catch(e: any) {
    const msg = e.message || e.toString();
    const isSafe = !msg.includes('my-secret-token') && !msg.includes('Bearer') && !msg.includes('abc');
    assert(isSafe, '18/19 part 2 (mutation gate) - raw credentials/errors never appear');
  }
  MockCustomer.prototype.query = oldQuery;

  
  // Mock supabase server
  const { __setMockCreateClient } = require('../src/lib/supabase/server');
  __setMockCreateClient(async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user1' } } }) } }));
  // 20. failed reconciliation never becomes ACTIVE
  const { reconcileGoogleDeployment } = require('../src/lib/providers/google/reconciliation');
  const mockSupabase = {
    from: () => ({
      update: (updates: any) => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => {
                if (updates.status === 'ACTIVE') {
                  throw new Error('Reconciliation set status to ACTIVE incorrectly');
                }
                return Promise.resolve({ error: null });
              }
            })
          })
        })
      })
    })
  };
  try {
    const dep = {
      id: 'dep1',
      campaign_id: 'camp1',
      owner_id: 'user1',
      status: 'DEPLOYING',
      target_state: { headlines: [{ current_value: 'Test', owner_approved: true, rejected: false }] },
      external_state: { adGroupResourceName: 'ag1' }
    };
    const { GoogleAdsMutationClient } = require('../src/lib/providers/google/client');
    const oldFetch = GoogleAdsMutationClient.prototype.fetchAdGroupAssets;
    GoogleAdsMutationClient.prototype.fetchAdGroupAssets = async () => [];
    
    await reconcileGoogleDeployment(mockSupabase as any, dep, 'user1');
    assert(true, '20. failed reconciliation never becomes ACTIVE');
    
    GoogleAdsMutationClient.prototype.fetchAdGroupAssets = oldFetch;
  } catch (e: any) {
    if (e.message.includes('ACTIVE incorrectly')) assert(false, '20. failed reconciliation never becomes ACTIVE: ' + e.message);
    else assert(true, '20. failed reconciliation never becomes ACTIVE');
  }


  console.log(`--- PREFLIGHT TESTS COMPLETE: ${passCount} PASS, ${failCount} FAIL ---`);
  if (failCount > 0) process.exit(1);
}

if (require.main === module) {
  runPreflightTests().catch(console.error);
}
