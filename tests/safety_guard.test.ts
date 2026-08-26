import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import './setup';
import { createClient } from '@supabase/supabase-js';

async function runTest() {
  console.log('--- STARTING SAFETY GUARD TEST ---');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://production.supabase.co';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fake-key';

  const supabase = createClient(supabaseUrl, supabaseKey);

  let caughtError = false;
  try {
    // This should be intercepted by our global fetch mock in setup.ts!
    const { error } = await supabase.from('integrations').insert({
      owner_id: '00000000-0000-0000-0000-000000000000',
      provider: 'test_provider',
      status: 'connected'
    });
    
    if (error && error.message.includes('HARD SAFETY GUARD')) {
      caughtError = true;
    } else {
      console.log('Returned error:', error);
    }
  } catch (error: any) {
    if (error.message && error.message.includes('HARD SAFETY GUARD')) {
      caughtError = true;
    }
  }

  if (caughtError) {
    console.log('PASS: Safety guard correctly intercepted and rejected production database write');
    console.log('PASS: Zero remote writes occurred');
    process.exit(0);
  } else {
    console.error('FAIL: Safety guard did NOT intercept production database write');
    process.exit(1);
  }
}

runTest().catch(console.error);
