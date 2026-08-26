import './setup';
import { upsertIntegration } from '../src/lib/integrations';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Mock modules
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
import { __setMockServiceClient } from '../src/lib/supabase/service';
import crypto from 'crypto';

let GET: any;

async function runTests() {
  GET = require('../src/app/api/integrations/google/callback/route').GET;
  
  console.log('--- STARTING UPSERT CONFLICT TESTS (ISOLATED) ---');
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

  const ownerId = '4aa63633-c560-4e1c-bdad-c397e9288939';

  // In-memory isolated database mock
  const db: any = {
    integrations: [],
    integration_credentials: [],
    oauth_states: [],
    idempotency_keys: []
  };

  const createMockTable = (tableName: string) => ({
    delete: () => {
      const chain: any = {
        eq: () => chain,
        is: () => chain,
        gt: () => chain,
        then: (cb: any) => cb({ data: null, error: null })
      };
      return chain;
    },
    insert: (payload: any) => {
      db[tableName].push(payload);
      return { data: payload, error: null };
    },
    update: (payload: any) => {
      const chain: any = {
        eq: () => chain,
        is: () => chain,
        gt: () => chain,
        select: () => chain,
        single: () => ({ data: payload, error: null }),
        then: (cb: any) => cb({ data: null, error: null })
      };
      return chain;
    },
    select: (cols: string = '*') => {
      const chain: any = {
        eq: () => chain,
        is: () => chain,
        gt: () => chain,
        single: () => ({ data: db[tableName].length > 0 ? db[tableName][0] : null, error: db[tableName].length === 0 ? new Error('Not found') : null }),
        then: (cb: any) => cb({ data: db[tableName], error: null })
      };
      return chain;
    },
    upsert: (payload: any, options: any) => {
      if ((tableName === 'integrations' || tableName === 'integration_credentials') && options?.onConflict !== 'owner_id,provider') {
        return { data: null, error: new Error('duplicate key value violates unique constraint') };
      }
      const existingIdx = db[tableName].findIndex((r: any) => r.owner_id === payload.owner_id && r.provider === payload.provider);
      if (existingIdx >= 0) {
        db[tableName][existingIdx] = { ...db[tableName][existingIdx], ...payload };
      } else {
        db[tableName].push(payload);
      }
      return { data: payload, error: null };
    }
  });

  const mockSupabase: any = {
    from: (tableName: string) => createMockTable(tableName),
    auth: {
      getUser: async () => ({ data: { user: { id: ownerId } }, error: null })
    }
  };

  __setMockCreateClient(() => mockSupabase);
  __setMockServiceClient(() => mockSupabase);

  // 1. Direct upsertIntegration test
  console.log('Test 1: Direct upsertIntegration() with existing row');
  
  // Create existing disconnected row
  db.integrations.push({
    owner_id: ownerId,
    provider: 'google',
    status: 'disconnected'
  });

  try {
    await upsertIntegration(ownerId, 'google', { access_token: 'test_token' }, 'connected', 'test_external_id');
    assert(true, 'upsertIntegration() succeeded without duplicate-key error');
  } catch (err: any) {
    assert(false, `upsertIntegration() threw error: ${err.message}`);
  }

  const rows = db.integrations.filter((r: any) => r.owner_id === ownerId && r.provider === 'google');
  assert(rows.length === 1, 'Exactly one integration row exists');
  assert(rows[0].status === 'connected', 'Existing row was updated rather than duplicated');
  assert(rows[0].external_id === 'test_external_id', 'External ID was updated');

  // 2. OAuth callback regression test
  console.log('Test 2: OAuth callback regression with existing row');
  
  // Reset back to disconnected
  db.integration_credentials = [];
  db.idempotency_keys = [];
  db.integrations[0].status = 'disconnected';
  db.integrations[0].external_id = null;
  
  __setMockLogAudit(async (...args: any[]) => { console.log('Audit logged:', args[1], args[6]); });

  const originalGetToken = OAuth2Client.prototype.getToken;
  const originalGetTokenInfo = OAuth2Client.prototype.getTokenInfo;
  
  OAuth2Client.prototype.getToken = async () => ({ tokens: { access_token: 'fake', refresh_token: 'fake_refresh' } } as any);
  OAuth2Client.prototype.getTokenInfo = async () => ({ aud: 'client-id', exp: 9999999999 } as any);

  const stateVal = 'test-state';
  const stateHash = crypto.createHash('sha256').update(stateVal).digest('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.oauth_states.push({ owner_id: ownerId, provider: 'google', state_hash: stateHash, consumed_at: null, expires_at: expiresAt });

  try {
    const req = new NextRequest(`http://localhost:3000/api/integrations/google/callback?code=mock_code&state=${stateVal}`);
    const res = await GET(req);
    
    assert(res.status === 307 || res.status === 302, 'Callback returns redirect');
    assert(res.headers.get('location')?.includes('success=true'), 'Callback redirects to success page (not error=oauth_failed)');

    const finalRows = db.integrations.filter((r: any) => r.owner_id === ownerId && r.provider === 'google');
    assert(finalRows.length === 1, 'OAuth callback maintained exactly one row');
    assert(finalRows[0].status === 'connected', 'OAuth callback successfully updated status to connected');

    const credRows = db.integration_credentials.filter((r: any) => r.owner_id === ownerId && r.provider === 'google');
    assert(credRows.length === 1, 'OAuth callback successfully saved integration_credentials');

  } catch (err: any) {
    assert(false, `OAuth callback threw unexpected error: ${err.message}`);
  } finally {
    OAuth2Client.prototype.getToken = originalGetToken;
    OAuth2Client.prototype.getTokenInfo = originalGetTokenInfo;
    __setMockCreateClient(null);
    __setMockServiceClient(null);
    __setMockLogAudit(null);
  }

  console.log(`\nResults: ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exit(1);
}

runTests().catch(console.error);
