import './setup';
import { createServiceClient } from '../src/lib/supabase/service';
import { decryptCredential } from '../src/lib/crypto';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function testDecryption() {
  console.log('--- STARTING DECRYPTION TEST ---');
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('integration_credentials')
      .select('*')
      .eq('provider', 'google');
      
    if (error) throw error;
    if (!data || data.length === 0) {
      console.log('FAIL: No Google credentials found in DB');
      process.exit(1);
    }
    
    const cred = data[0];
    const parsed = JSON.parse(cred.encrypted_credentials);
    
    // Attempt decryption
    const decryptedRefresh = decryptCredential(parsed.refresh_token);
    
    if (decryptedRefresh) {
      console.log('PASS: Existing stored encrypted credential successfully decrypted');
    }
  } catch (err: any) {
    console.error('FAIL: Decryption failed:', err.message);
    process.exit(1);
  }
}

testDecryption();
