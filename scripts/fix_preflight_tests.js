const fs = require('fs');
let code = fs.readFileSync('tests/milestone6_preflight.test.ts', 'utf8');

const targetStr = `  assert(true, '16. invalid budget -> rejected (handled in authoritative validation)');
  assert(true, '18. raw credentials never appear in logs');
  assert(true, '19. raw Google errors never appear in logs');
  assert(true, '20. failed reconciliation never becomes ACTIVE');`;

const realTests = `
  // 16. invalid budget
  resetEnv();
  const { calculateSafetyLimits } = require('../src/lib/campaigns/safeguards');
  try {
    calculateSafetyLimits('daily', 50001, 10);
    assert(false, '16. invalid budget -> rejected');
  } catch (e: any) {
    assert(e.message.includes('exceeds safety limits') || e.message.includes('above'), '16. invalid budget -> rejected');
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
    assert(false, '20. failed reconciliation never becomes ACTIVE: ' + e.message);
  }
`;

code = code.replace(targetStr, realTests);
fs.writeFileSync('tests/milestone6_preflight.test.ts', code);
