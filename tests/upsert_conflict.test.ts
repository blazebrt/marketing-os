import { upsertIntegration } from '../src/lib/integrations';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Mock modules so we can test the callback route
(global as any).mockCookieState = 'test-state';
process.env.ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

import Module from 'module';
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'next/headers') {
    return {
      cookies: () => ({
        get: () => ({ value: (global as any).mockCookieState }),
        delete: () => {}
      })
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import { NextRequest } from 'next/server';
import { OAuth2Client } from 'google-auth-library';
import { __setMockLogAudit } from '../src/lib/audit';
import { __setMockCreateClient } from '../src/lib/supabase/server';

let GET: any;

async function runTests() {
  GET = require('../src/app/api/integrations/google/callback/route').GET;
  
  console.log('--- STARTING UPSERT CONFLICT TESTS ---');
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

  // Generate a mock user ID
  const ownerId = '4aa63633-c560-4e1c-bdad-c397e9288939'; // Using existing test user

  // Clean up any existing records for test user
  await supabase.from('integration_credentials').delete().eq('owner_id', ownerId).eq('provider', 'google');
  await supabase.from('integrations').delete().eq('owner_id', ownerId).eq('provider', 'google');

  // Mock server functions early for Test 1
  __setMockCreateClient(() => supabase);

  // 1. Direct upsertIntegration test
  console.log('Test 1: Direct upsertIntegration() with existing row');
  
  // Create existing disconnected row
  await supabase.from('integrations').insert({
    owner_id: ownerId,
    provider: 'google',
    status: 'disconnected'
  });

  try {
    // Call upsertIntegration (should update, not throw duplicate key error)
    await upsertIntegration(ownerId, 'google', { access_token: 'test_token' }, 'connected', 'test_external_id');
    assert(true, 'upsertIntegration() succeeded without duplicate-key error');
  } catch (err: any) {
    assert(false, `upsertIntegration() threw error: ${err.message}`);
  }

  const { data: rows } = await supabase.from('integrations').select('*').eq('owner_id', ownerId).eq('provider', 'google');
  assert(rows?.length === 1, 'Exactly one integration row exists');
  assert(rows?.[0].status === 'connected', 'Existing row was updated rather than duplicated');
  assert(rows?.[0].external_id === 'test_external_id', 'External ID was updated');

  // 2. OAuth callback regression test
  console.log('Test 2: OAuth callback regression with existing row');
  
  // Reset back to disconnected
  await supabase.from('integration_credentials').delete().eq('owner_id', ownerId).eq('provider', 'google');
  await supabase.from('integrations').update({ status: 'disconnected', external_id: null }).eq('owner_id', ownerId).eq('provider', 'google');
  await supabase.from('idempotency_keys').delete().eq('owner_id', ownerId);

  // Give supabase mock getUser
  supabase.auth.getUser = async () => ({ data: { user: { id: ownerId } }, error: null } as any);
  
  __setMockLogAudit(async (...args: any[]) => { console.log('Audit logged:', args[1], args[6]); }); // Log audit reason

  const originalGetToken = OAuth2Client.prototype.getToken;
  const originalGetTokenInfo = OAuth2Client.prototype.getTokenInfo;
  
  OAuth2Client.prototype.getToken = async () => ({ tokens: { access_token: 'fake', refresh_token: 'fake_refresh' } } as any);
  OAuth2Client.prototype.getTokenInfo = async () => ({ aud: 'client-id', exp: 9999999999 } as any);

  // Fix ENCRYPTION_KEY for the test
  process.env.ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

  // We need to inject a valid state into oauth_states so consumeOAuthState works
  const stateVal = 'test-state';
  const crypto = require('crypto');
  const stateHash = crypto.createHash('sha256').update(stateVal).digest('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await supabase.from('oauth_states').insert({ owner_id: ownerId, provider: 'google', state_hash: stateHash, consumed_at: null, expires_at: expiresAt });

  try {
    const req = new NextRequest(`http://localhost:3000/api/integrations/google/callback?code=mock_code&state=${stateVal}`);
    const res = await GET(req);
    
    assert(res.status === 307 || res.status === 302, 'Callback returns redirect');
    assert(res.headers.get('location')?.includes('success=true'), 'Callback redirects to success page (not error=oauth_failed)');

    const { data: finalRows } = await supabase.from('integrations').select('*').eq('owner_id', ownerId).eq('provider', 'google');
    assert(finalRows?.length === 1, 'OAuth callback maintained exactly one row');
    assert(finalRows?.[0].status === 'connected', 'OAuth callback successfully updated status to connected');

    const { data: credRows } = await supabase.from('integration_credentials').select('*').eq('owner_id', ownerId).eq('provider', 'google');
    assert(credRows?.length === 1, 'OAuth callback successfully saved integration_credentials');

  } catch (err: any) {
    assert(false, `OAuth callback threw unexpected error: ${err.message}`);
  } finally {
    OAuth2Client.prototype.getToken = originalGetToken;
    OAuth2Client.prototype.getTokenInfo = originalGetTokenInfo;
    __setMockCreateClient(null);
    __setMockLogAudit(null);
  }

  console.log(`\nResults: ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exit(1);
}

runTests().catch(console.error);
