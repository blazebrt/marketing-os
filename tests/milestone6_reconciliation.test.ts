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
  mockServiceModule.__setMockServiceClient(async () => createMockServiceClient());

  const mockServerModule = require('../src/lib/supabase/server');
  mockServerModule.__setMockCreateClient(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ownerA } }, error: null }) }
  }));
  const mockAuditModule = require('../src/lib/audit');
  mockAuditModule.__setMockLogAudit(async () => {});

  (testAccount as any).__setMockGoogleAdsApi(class {
    Customer() { return { async query() { return [{ customer: { test_account: true } }]; } }; }
  });

  const tokens = { access_token: encryptCredential('a'), refresh_token: encryptCredential('b') };
  await db.query("INSERT INTO public.integration_credentials (owner_id, provider, encrypted_credentials) VALUES ($1, 'google', $2)", [ownerA, JSON.stringify(tokens)]);

  const targetState = { 
    campaign: { budget: 1000 },
    bidding: { strategy: 'MANUAL_CPC' },
    adGroup: { name: 'Test' },
    destination: { url: 'https://test.com' },
    headlines: [], descriptions: [], keywords: []
  };
  
  // Test 1: Missing resources in external state
  {
    await db.query("DELETE FROM public.channel_deployments");
    await db.query("INSERT INTO public.channel_deployments (campaign_id, owner_id, provider, target_state, external_state) VALUES ($1, $2, 'google', $3, '{}')", [campId, ownerA, JSON.stringify(targetState)]);
    
    const result = await reconcileGoogleDeployment(campId, ownerA);
    assert(result.status === 'MISSING', 'Detects missing resource ID in external state');
  }

  const fullExternalState = {
    campaignResourceName: 'camp-1',
    adGroupResourceName: 'ag-1',
    adResourceNames: ['ad-1'],
    keywordResourceNames: ['kw-1']
  };

  // Test 2: Drift detection (budget changed in Google Ads)
  {
    class MockGoogleAdsApi {
      constructor(opts: any) {}
      Customer() { 
        return { 
          async query(q: string) {
            if (q.includes('campaign_budget')) return [{ campaign: { bidding_strategy_type: 'MANUAL_CPC' }, campaign_budget: { amount_micros: 2000000000 } }];
            if (q.includes('ad_group.type')) return [{ ad_group: { name: 'Test' }, campaign: { resource_name: 'camp-1' } }];
            if (q.includes('responsive_search_ad')) return [{ ad_group_ad: { ad: { final_urls: ['https://test.com'], responsive_search_ad: { headlines: [], descriptions: [] } } } }];
            if (q.includes('ad_group_criterion.keyword')) return [{ ad_group_criterion: { keyword: { text: 'fake', match_type: 'EXACT' } } }];
            return [];
          } 
        }; 
      }
    }
    __setMockGoogleAdsApi(MockGoogleAdsApi);

    await db.query("DELETE FROM public.channel_deployments");
    await db.query("INSERT INTO public.channel_deployments (campaign_id, owner_id, provider, target_state, external_state) VALUES ($1, $2, 'google', $3, $4)", [campId, ownerA, JSON.stringify(targetState), JSON.stringify(fullExternalState)]);
    
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
          async query(q: string) {
            if (q.includes('campaign_budget')) return [{ campaign: { bidding_strategy_type: 'MANUAL_CPC' }, campaign_budget: { amount_micros: 1000000000 } }];
            if (q.includes('ad_group.type')) return [{ ad_group: { name: 'Test' }, campaign: { resource_name: 'camp-1' } }];
            if (q.includes('responsive_search_ad')) return [{ ad_group_ad: { ad: { final_urls: ['https://test.com'], responsive_search_ad: { headlines: [], descriptions: [] } } } }];
            if (q.includes('ad_group_criterion.keyword')) return []; // No keywords required in targetState
            return [];
          } 
        }; 
      }
    }
    __setMockGoogleAdsApi(MockGoogleAdsApi);

    await db.query("DELETE FROM public.channel_deployments");
    await db.query("INSERT INTO public.channel_deployments (campaign_id, owner_id, provider, target_state, external_state) VALUES ($1, $2, 'google', $3, $4)", [campId, ownerA, JSON.stringify(targetState), JSON.stringify({ ...fullExternalState, keywordResourceNames: [] })]);
    
    const result = await reconcileGoogleDeployment(campId, ownerA);
    if (result.status !== 'MATCH') {
      console.error('Test 3 differences:', result.differences);
    }
    assert(result.status === 'MATCH', 'Detects exact match with target state');
  }

  console.log(`\n--- TESTS COMPLETE: ${passCount} PASS, ${failCount} FAIL ---`);
  if (failCount > 0) process.exit(1);
}

runTests().catch(console.error);
