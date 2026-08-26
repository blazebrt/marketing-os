const fs = require('fs');
let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

// Insert the preflight tests right before `if (failCount > 0) process.exit(1);` at the end
const tests = `
  console.log('\\n--- STARTING PREFLIGHT VERIFICATION TESTS ---');
  const { checkPreflightEnvironment } = require('../scripts/google_preflight');
  
  const backupEnv = { ...process.env };
  const resetPreflightEnv = () => {
    process.env = { ...backupEnv };
    process.env.GOOGLE_ADS_EXECUTION_MODE = 'test';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'token';
    process.env.GOOGLE_ADS_TEST_CUSTOMER_ID = '123-456-7890';
    process.env.GOOGLE_ADS_TEST_MANAGER_ID = '123-456-7890';
    process.env.GOOGLE_CLIENT_ID = 'client';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.ENCRYPTION_KEY = 'key';
    process.env.SUPABASE_URL = 'url';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
  };

  resetPreflightEnv();
  process.env.GOOGLE_ADS_EXECUTION_MODE = 'production';
  try { await checkPreflightEnvironment(); assert(false, 'Mode production blocked'); } catch (e: any) { assert(e.message.includes('GOOGLE_ADS_EXECUTION_MODE must be "test"'), 'Mode production blocked'); }

  resetPreflightEnv();
  delete process.env.GOOGLE_CLIENT_ID;
  try { await checkPreflightEnvironment(); assert(false, 'Missing credentials blocked'); } catch (e: any) { assert(e.message.includes('Missing GOOGLE_CLIENT_ID'), 'Missing credentials blocked'); }

  resetPreflightEnv();
  process.env.GOOGLE_ADS_TEST_CUSTOMER_ID = 'invalid';
  try { await checkPreflightEnvironment(); assert(false, 'Invalid customer ID blocked'); } catch (e: any) { assert(e.message.includes('syntactically invalid'), 'Invalid customer ID blocked'); }

  resetPreflightEnv();
  try { await checkPreflightEnvironment(); assert(true, 'Correct environment passes'); } catch (e: any) { assert(false, 'Correct environment passes'); }
`;

content = content.replace("if (failCount > 0) process.exit(1);", tests + "\n  if (failCount > 0) process.exit(1);");

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', content);
