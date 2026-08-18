import { PGlite } from '@electric-sql/pglite';
import crypto from 'crypto';
import { reconcileGoogleDeployment, __setMockGoogleAdsApi } from '../src/lib/providers/google/reconciliation';
import { encryptCredential } from '../src/lib/crypto';
import * as testAccount from '../src/lib/providers/google/test-account';

async function runTests() {
  console.log('--- STARTING MILESTONE 6 RECONCILIATION TESTS ---');
  let passCount = 0;
  let failCount = 0;

  const assert = (condition: boolean, msg: string) => {
    if (condition) {
      console.log(`PASS: ${msg}`);
      passCount++;
    } else {
      console.error(`FAIL: ${msg}`);
      failCount++;
    }
  };

  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  process.env.GOOGLE_ADS_EXECUTION_MODE = 'test';
  process.env.GOOGLE_ADS_TEST_CUSTOMER_ID = '123';
  process.env.GOOGLE_ADS_TEST_MANAGER_ID = '123';
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'token';
  process.env.GOOGLE_CLIENT_ID = 'client';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';

  const db = new PGlite();
  await db.exec(`
    create table public.integration_credentials (
      id uuid primary key default gen_random_uuid(), owner_id uuid not null, provider text not null,
      encrypted_credentials text not null
    );
    create table public.channel_deployments (
      id uuid primary key default gen_random_uuid(), campaign_id uuid not null, owner_id uuid not null,
      provider text not null, target_state jsonb not null, external_state jsonb not null,
      reconciliation_status text
    );
    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(), owner_id uuid not null, action text not null,
      resource_type text, resource_id text, details jsonb
    );
  `);

  const ownerA = crypto.randomUUID();
  const campId = crypto.randomUUID();

  // Mock service client
  const createMockServiceClient = () => {
    return {
      from: (table: string) => {
        let queryStr = `SELECT * FROM public.${table}`;
        let conditions: string[] = [];
        let params: any[] = [];
        let isUpdate = false;
        let data: any = null;

        const chain = {
          select: (s: string) => chain,
          update: (obj: any) => { isUpdate = true; data = obj; return chain; },
          insert: (obj: any) => { return chain; },
          eq: (col: string, val: any) => { params.push(val); conditions.push(`${col}=$${params.length}`); return chain; },
          single: async () => {
            if (conditions.length > 0) queryStr += ' WHERE ' + conditions.join(' AND ');
            const res = await db.query(queryStr, params);
            return { data: res.rows[0] || null, error: res.rows.length === 0 ? { code: 'PGRST116' } : null };
          },
          then: async (resolve: any) => {
            if (isUpdate) {
              let updateQuery = `UPDATE public.${table} SET `;
              let setParts: string[] = [];
              let valIdx = 1;
              const updateParams: any[] = [];
              for (const [k, v] of Object.entries(data)) {
                setParts.push(`${k}=$${valIdx++}`);
                updateParams.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
              }
              updateQuery += setParts.join(', ');
              if (conditions.length > 0) {
                updateQuery += ' WHERE ' + conditions.map((c, i) => c.replace(`$${i+1}`, `$${valIdx + i}`)).join(' AND ');
                updateParams.push(...params);
              }
              await db.query(updateQuery, updateParams);
              resolve({ error: null });
            } else {
              resolve(await chain.single());
            }
          }
        };

        const proxy = new Proxy(chain, {
          get(target, prop) {
            if (prop === 'then') return isUpdate ? target.then : async (resolve: any) => resolve(await target.single());
            return (target as any)[prop];
          }
        });
        return proxy;
      }
    };
  };

  const mockServiceModule = require('../src/lib/supabase/service');
  mockServiceModule.createServiceClient = async () => createMockServiceClient();
  const mockAuditModule = require('../src/lib/audit');
  mockAuditModule.__setMockLogAudit(async () => {});

  (testAccount as any).__setMockGoogleAdsApi(class {
    Customer() { return { async query() { return [{ customer: { test_account: true } }]; } }; }
  });

  const tokens = { access_token: encryptCredential('a'), refresh_token: encryptCredential('b') };
  await db.query("INSERT INTO public.integration_credentials (owner_id, provider, encrypted_credentials) VALUES ($1, 'google', $2)", [ownerA, JSON.stringify(tokens)]);

  const targetState = { campaign: { budget: 1000 } };
  
  // Test 1: Missing resources in external state
  {
    await db.query("DELETE FROM public.channel_deployments");
    await db.query("INSERT INTO public.channel_deployments (campaign_id, owner_id, provider, target_state, external_state) VALUES ($1, $2, 'google', $3, '{}')", [campId, ownerA, JSON.stringify(targetState)]);
    
    const result = await reconcileGoogleDeployment(campId, ownerA);
    assert(result.status === 'MISSING', 'Detects missing resource ID in external state');
  }

  // Test 2: Drift detection (budget changed in Google Ads)
  {
    class MockGoogleAdsApi {
      constructor(opts: any) {}
      Customer() { 
        return { 
          async query() { 
            return [{ 
              campaign: { id: '1', name: 'Test', status: 'ENABLED', bidding_strategy_type: 'MANUAL_CPC' },
              campaign_budget: { amount_micros: 2000000000 } // Drifted from 1000 * 1000000
            }]; 
          } 
        }; 
      }
    }
    __setMockGoogleAdsApi(MockGoogleAdsApi);

    await db.query("DELETE FROM public.channel_deployments");
    await db.query("INSERT INTO public.channel_deployments (campaign_id, owner_id, provider, target_state, external_state) VALUES ($1, $2, 'google', $3, $4)", [campId, ownerA, JSON.stringify(targetState), JSON.stringify({ campaignResourceName: 'camp-1' })]);
    
    const result = await reconcileGoogleDeployment(campId, ownerA);
    assert(result.status === 'DRIFT', 'Detects budget drift from Google Ads');
    assert(result.differences.some((d: string) => d.includes('Budget mismatch')), 'Reports budget difference details');
  }

  // Test 3: Match detection
  {
    class MockGoogleAdsApi {
      constructor(opts: any) {}
      Customer() { 
        return { 
          async query() { 
            return [{ 
              campaign: { id: '1', name: 'Test', status: 'ENABLED', bidding_strategy_type: 'MANUAL_CPC' },
              campaign_budget: { amount_micros: 1000000000 } // Matches 1000 * 1000000
            }]; 
          } 
        }; 
      }
    }
    __setMockGoogleAdsApi(MockGoogleAdsApi);

    await db.query("DELETE FROM public.channel_deployments");
    await db.query("INSERT INTO public.channel_deployments (campaign_id, owner_id, provider, target_state, external_state) VALUES ($1, $2, 'google', $3, $4)", [campId, ownerA, JSON.stringify(targetState), JSON.stringify({ campaignResourceName: 'camp-1' })]);
    
    const result = await reconcileGoogleDeployment(campId, ownerA);
    assert(result.status === 'MATCH', 'Detects exact match with target state');
    
    const depRes = await db.query("SELECT reconciliation_status FROM public.channel_deployments");
    assert((depRes.rows[0] as any).reconciliation_status === 'MATCH', 'Updates DB status to MATCH');
  }

  console.log(`\n--- TESTS COMPLETE: ${passCount} PASS, ${failCount} FAIL ---`);
  if (failCount > 0) process.exit(1);
}

runTests().catch(console.error);
