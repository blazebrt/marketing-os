import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { decryptCredential } from '../src/lib/crypto';
import { verifyTestAccount } from '../src/lib/providers/google/test-account';

config({ path: '.env.local' });

export async function checkPreflightEnvironment() {
  if (process.env.GOOGLE_ADS_EXECUTION_MODE !== 'test') {
    throw new Error('FAIL CLOSED: GOOGLE_ADS_EXECUTION_MODE must be "test"');
  }

  
  const requiredVars = [
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'GOOGLE_ADS_TEST_CUSTOMER_ID',
    'GOOGLE_ADS_TEST_MANAGER_ID',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'ENCRYPTION_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];

  for (const v of requiredVars) {
    if (!process.env[v]) {
      throw new Error(`FAIL CLOSED: Missing ${v}`);
    }
  }

  const testCustomerId = process.env.GOOGLE_ADS_TEST_CUSTOMER_ID!;
  if (!/^\d{10}$/.test(testCustomerId) && !/^\d{3}-\d{3}-\d{4}$/.test(testCustomerId)) {
    throw new Error('FAIL CLOSED: GOOGLE_ADS_TEST_CUSTOMER_ID is syntactically invalid');
  }
}

export async function runPreflight() {
  await checkPreflightEnvironment();

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  
  const { data: creds, error } = await supabase
    .from('integration_credentials')
    .select('encrypted_credentials')
    .eq('provider', 'google')
    .limit(1)
    .single();

  if (error || !creds) {
    throw new Error('FAIL CLOSED: No google integration credentials found in DB to test.');
  }

  const decrypted = JSON.parse(creds.encrypted_credentials);
  const refreshToken = decryptCredential(decrypted.refresh_token);

  const testCustomerId = process.env.GOOGLE_ADS_TEST_CUSTOMER_ID!;

  try {
    const verifiedId = await verifyTestAccount(
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      refreshToken,
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      testCustomerId,
      process.env.GOOGLE_ADS_TEST_MANAGER_ID!
    );

    if (verifiedId !== testCustomerId.replace(/-/g, '')) {
      throw new Error('FAIL CLOSED: Returned customer ID does not match exact test customer ID.');
    }

    const maskedCustomerId = testCustomerId.replace(/\d(?=\d{4})/g, '*');
    const maskedManagerId = process.env.GOOGLE_ADS_TEST_MANAGER_ID!.replace(/\d(?=\d{4})/g, '*');

    console.log(`EXECUTION MODE: TEST`);
    console.log(`CUSTOMER: ${maskedCustomerId}`);
    console.log(`TEST ACCOUNT: VERIFIED`);
    console.log(`MANAGER: ${maskedManagerId}`);
    console.log(`OAUTH: VERIFIED`);
    console.log(`MUTATION TARGET: TEST ACCOUNT ONLY`);
    console.log(`PREFLIGHT: PASS`);

    return true;
  } catch (err: any) {
    throw new Error('PREFLIGHT_FAILED');
  }
}

if (require.main === module) {
  runPreflight().catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}
