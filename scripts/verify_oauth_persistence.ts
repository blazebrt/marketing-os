import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { decryptCredential } from '../src/lib/crypto';

dotenv.config({ path: '.env.local' });

async function verify() {
  console.log('--- VERIFYING OAUTH PERSISTENCE ---');
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // We find the test user owner ID, assuming it's the one we used in testing
  // Or just find the most recently updated Google integration.
  const { data: integrations, error: intError } = await supabase
    .from('integrations')
    .select('*')
    .eq('provider', 'google')
    .order('updated_at', { ascending: false })
    .limit(1);

  if (intError || !integrations || integrations.length === 0) {
    console.log('FAIL: No Google integrations found.');
    return;
  }

  const integration = integrations[0];
  const ownerId = integration.owner_id;

  assert(integration.status === 'connected', 'INTEGRATION STATUS is connected');
  assert(!!ownerId, 'OWNER MATCH: Owner is associated');

  const { data: allUserIntegrations } = await supabase
    .from('integrations')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('provider', 'google');

  assert(allUserIntegrations?.length === 1, 'DUPLICATE GOOGLE INTEGRATIONS: No (Exactly one exists)');

  const { data: credentials, error: credError } = await supabase
    .from('integration_credentials')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('provider', 'google');

  if (credError || !credentials || credentials.length === 0) {
    console.log('FAIL: CREDENTIAL ROW exists: NO');
    return;
  }
  
  assert(true, 'CREDENTIAL ROW exists: YES');
  
  const credential = credentials[0];
  assert(!!credential.encrypted_credentials, 'ENCRYPTED CREDENTIAL populated: YES');

  let decryptSuccess = false;
  let isValidStructure = false;
  try {
    const parsed = JSON.parse(credential.encrypted_credentials);
    const decryptedRefresh = decryptCredential(parsed.refresh_token);
    
    if (decryptedRefresh && typeof decryptedRefresh === 'string') {
      isValidStructure = true;
    }
    decryptSuccess = true;
  } catch (err: any) {
    console.error('Decryption error:', err.message);
  }

  assert(decryptSuccess, 'CURRENT CREDENTIAL DECRYPTS: YES');
  assert(isValidStructure, 'Decrypted credential has valid refresh_token structure');
  
  console.log(`\nVerification complete. ${passCount} checks passed, ${failCount} failed.`);
}

verify().catch(console.error);
