const fs = require('fs');

let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

// 1. Change `MKTOS-d1-` to `MKTOS-E2E-d1-`
content = content.replace(/MKTOS-d1-/g, 'MKTOS-E2E-d1-');

// 2. Add the required environment variables at the top of runTests
const envSetupStr = `  process.env.GOOGLE_ADS_EXECUTION_MODE = 'test';
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'token';
  process.env.GOOGLE_CLIENT_ID = 'client';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.GOOGLE_ADS_TEST_CUSTOMER_ID = '123';
  process.env.GOOGLE_ADS_TEST_MANAGER_ID = '123';`;

const newEnvSetupStr = `  process.env.GOOGLE_ADS_EXECUTION_MODE = 'test';
  process.env.GOOGLE_ADS_ALLOW_MUTATIONS = 'true';
  process.env.GOOGLE_ADS_DEPLOYMENT_CONFIRMATION = 'CONFIRMED';
  process.env.NODE_ENV = 'test';
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'token';
  process.env.GOOGLE_CLIENT_ID = 'client';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.GOOGLE_ADS_TEST_CUSTOMER_ID = '123';
  process.env.GOOGLE_ADS_TEST_MANAGER_ID = '123';`;

content = content.replace(envSetupStr, newEnvSetupStr);

// 3. Add the 9 new kill switch tests before the "--- COMPREHENSIVE TESTS COMPLETE" footer.
// Let's insert them right before: if (failCount > 0) process.exit(1);

const newTests = `
  console.log('\\n--- STARTING MILESTONE 6.1 KILL SWITCH TESTS ---');
  await resetDeployment();

  // KS1: Execution mode != test
  process.env.GOOGLE_ADS_EXECUTION_MODE = 'prod';
  try { await deployGoogleCampaign(campId, ownerA); assert(false, 'KS1'); } catch(e: any) { assert(e.message.includes('REAL_TEST_MUTATION_NOT_AUTHORIZED'), 'KS1. execution mode != test blocked'); }
  process.env.GOOGLE_ADS_EXECUTION_MODE = 'test';
  
  // KS2: Allow mutations != true
  process.env.GOOGLE_ADS_ALLOW_MUTATIONS = 'false';
  await resetDeployment();
  try { await deployGoogleCampaign(campId, ownerA); assert(false, 'KS2'); } catch(e: any) { assert(e.message.includes('REAL_TEST_MUTATION_NOT_AUTHORIZED'), 'KS2. allow mutations != true blocked'); }
  process.env.GOOGLE_ADS_ALLOW_MUTATIONS = 'true';

  // KS3: test_account != true
  await resetDeployment();
  (global as any).mockQueryFunc = async function(q: string) {
    if (q.includes('customer.test_account')) return [{ customer: { id: 123, test_account: false, descriptive_name: 'Prod Account' } }];
    return '__FALLTHROUGH__';
  };
  try { await deployGoogleCampaign(campId, ownerA); assert(false, 'KS3'); } catch(e: any) { assert(e.message.includes('NOT a test account'), 'KS3. test_account != true blocked'); }

  // KS4: verified customer != configured customer
  await resetDeployment();
  process.env.GOOGLE_ADS_TEST_CUSTOMER_ID = '999';
  (global as any).mockQueryFunc = async function(q: string) {
    if (q.includes('customer.test_account')) return [{ customer: { id: 123, test_account: true, descriptive_name: 'Test Account' } }];
    return '__FALLTHROUGH__';
  };
  try { await deployGoogleCampaign(campId, ownerA); assert(false, 'KS4'); } catch(e: any) { assert(e.message.includes('Verified customer ID does not match configured test customer ID'), 'KS4. verified customer != configured blocked'); }
  process.env.GOOGLE_ADS_TEST_CUSTOMER_ID = '123';

  // KS5: production NODE_ENV
  await resetDeployment();
  process.env.NODE_ENV = 'production';
  (global as any).mockQueryFunc = null;
  try { await deployGoogleCampaign(campId, ownerA); assert(false, 'KS5'); } catch(e: any) { assert(e.message.includes('REAL_TEST_MUTATION_NOT_AUTHORIZED'), 'KS5. production NODE_ENV blocked'); }
  process.env.NODE_ENV = 'test';

  // KS6: Missing credentials
  await resetDeployment();
  await db.exec(\`DELETE FROM integration_credentials\`);
  try { await deployGoogleCampaign(campId, ownerA); assert(false, 'KS6'); } catch(e: any) { assert(e.message.includes('credentials missing'), 'KS6. missing credentials blocked'); }
  // Put them back
  await db.exec(\`INSERT INTO integration_credentials (owner_id, provider, encrypted_credentials) VALUES ('\${ownerA}', 'google', '\${encCreds}')\`);

  // KS7: Missing confirmation
  await resetDeployment();
  process.env.GOOGLE_ADS_DEPLOYMENT_CONFIRMATION = 'NOPE';
  try { await deployGoogleCampaign(campId, ownerA); assert(false, 'KS7'); } catch(e: any) { assert(e.message.includes('REAL_TEST_MUTATION_NOT_AUTHORIZED'), 'KS7. unconfirmed blocked'); }
  process.env.GOOGLE_ADS_DEPLOYMENT_CONFIRMATION = 'CONFIRMED';
  
`;

content = content.replace('  if (failCount > 0) process.exit(1);', newTests + '  if (failCount > 0) process.exit(1);');

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', content);
