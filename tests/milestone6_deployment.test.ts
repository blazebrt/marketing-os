import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import './setup';
import { PGlite } from '@electric-sql/pglite';
import crypto from 'crypto';
import { deployGoogleCampaign } from '../src/lib/providers/google/deployment';
import { __setMockGoogleAdsApi } from '../src/lib/providers/google/client';
import { __setMockGoogleAdsApi as __setMockReconciliationApi } from '../src/lib/providers/google/reconciliation';
import { encryptCredential } from '../src/lib/crypto';
import * as testAccount from '../src/lib/providers/google/test-account';

// Mock DB infrastructure similar to M5
async function runTests() {
  console.log('--- STARTING MILESTONE 6 DEPLOYMENT TESTS ---');
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

  const testKey = crypto.randomBytes(32).toString('base64');
  process.env.ENCRYPTION_KEY = testKey;
  process.env.GOOGLE_ADS_EXECUTION_MODE = 'test';
  process.env.GOOGLE_ADS_TEST_CUSTOMER_ID = '123';
  process.env.GOOGLE_ADS_TEST_MANAGER_ID = '123';
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'token';
  process.env.GOOGLE_CLIENT_ID = 'client';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';

  const db = new PGlite();
  // Setup tables
  await db.exec(`
    create table public.integration_credentials (
      id uuid primary key default gen_random_uuid(), owner_id uuid not null, provider text not null,
      encrypted_credentials text not null, unique(owner_id, provider)
    );
    create table public.unified_campaigns (
      id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text not null default 'Test',
      budget_amount numeric not null default 1000, duration_days int not null default 30,
      budget_type text not null default 'DAILY', max_daily_spend numeric default 1000,
      max_campaign_spend numeric default 30000, max_auto_budget_increase boolean default false
    );
    create table public.channel_deployments (
      id uuid primary key default gen_random_uuid(), campaign_id uuid not null, owner_id uuid not null,
      provider text not null, status text not null default 'READY_TO_DEPLOY', target_state jsonb not null default '{}'::jsonb,
      external_state jsonb not null default '{}'::jsonb, failure_code text, failure_stage text,
      reconciliation_status text, locked_at timestamptz, locked_by text
    );
    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(), owner_id uuid not null, action text not null,
      resource_type text, resource_id text, details jsonb
    );
  `);

  const ownerA = crypto.randomUUID();

  // Mock service client
  const createMockServiceClient = () => {
    return {
      from: (table: string) => {
        let queryStr = `SELECT * FROM public.${table}`;
        let conditions: string[] = [];
        let params: any[] = [];
        let isUpdate = false;
        let isInsert = false;
        let data: any = null;

        const chain = {
          select: (s: string) => chain,
          update: (obj: any) => { isUpdate = true; data = obj; return chain; },
          insert: (obj: any) => { isInsert = true; data = obj; return chain; },
          eq: (col: string, val: any) => { params.push(val); conditions.push(`${col}=$${params.length}`); return chain; },
          in: (col: string, vals: any[]) => {
            const placeholders = vals.map(v => { params.push(v); return `$${params.length}`; }).join(',');
            conditions.push(`${col} IN (${placeholders})`);
            return chain;
          },
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
            } else if (isInsert) {
              let insertQuery = `INSERT INTO public.${table} (`;
              let keys = Object.keys(data);
              insertQuery += keys.join(', ') + ') VALUES (';
              insertQuery += keys.map((_, i) => `$${i+1}`).join(', ') + ')';
              let insertParams = keys.map(k => typeof data[k] === 'object' && data[k] !== null ? JSON.stringify(data[k]) : data[k]);
              await db.query(insertQuery, insertParams);
              resolve({ error: null });
            } else {
              resolve(await chain.single());
            }
          }
        };

        const proxy = new Proxy(chain, {
          get(target, prop) {
            if (prop === 'then') return isUpdate || isInsert ? target.then : async (resolve: any) => resolve(await target.single());
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
  mockAuditModule.__setMockLogAudit(async (actor: string, action: string, type: string, id: string, before: any, after: any, reason: string) => {
    await db.query("INSERT INTO public.audit_logs (owner_id, action, resource_type, resource_id, details) VALUES ($1, $2, $3, $4, $5)", [actor, action, type, id, JSON.stringify({ before, after, reason })]);
  });

  // Mock test account verification globally so we don't need real API keys
  (testAccount as any).__setMockGoogleAdsApi(class {
    Customer() { return { async query() { return [{ customer: { test_account: true } }]; } }; }
  });

  // Mock Google Ads Client
  let mutatedResources: string[] = [];
  let shouldFailAt: string | null = null;
  let existingRemoteResources: any = {};
  class MockCustomer {
    async query(q: string) {
      if (q.includes('test_account')) return [{ customer: { test_account: true } }];
      if (q.includes('campaign_budget.name')) return existingRemoteResources.budget ? [{ campaign_budget: { resource_name: existingRemoteResources.budget } }] : [];
      if (q.includes('campaign.name') && !q.includes('campaign.status')) return existingRemoteResources.campaign ? [{ campaign: { resource_name: existingRemoteResources.campaign } }] : [];
      if (q.includes('ad_group.name') && !q.includes('ad_group.type')) return existingRemoteResources.adGroup ? [{ ad_group: { resource_name: existingRemoteResources.adGroup } }] : [];
      if (q.includes('responsive_search_ad.headlines')) return [{ ad_group_ad: { ad: { final_urls: ['https://example.com'], responsive_search_ad: { headlines: [{text: 'H1'}] } } } }];
      if (q.includes('ad_group_ad.ad.resource_name')) return existingRemoteResources.ad ? [{ ad_group_ad: { ad: { resource_name: existingRemoteResources.ad } } }] : [];
      if (q.includes('ad_group_criterion.keyword.text')) return [{ ad_group_criterion: { keyword: { text: 'K1', match_type: 'EXACT' } } }];
      if (q.includes('ad_group_criterion.type')) return existingRemoteResources.keyword ? [{ ad_group_criterion: { resource_name: existingRemoteResources.keyword } }] : [];
      if (q.includes('bidding_strategy_type')) return [{ campaign: { name: 'Test', bidding_strategy_type: 'MANUAL_CPC' }, campaign_budget: { amount_micros: 1000 * 1000000 } }];
      if (q.includes('ad_group.type')) return [{ ad_group: { name: 'Ad Group 1' }, campaign: { resource_name: existingRemoteResources.campaign || 'c1' } }];
      return [];
    }
    async mutateResources(ops: any[]) {
      if (shouldFailAt === ops[0].entity) throw new Error(`Simulated failure for ${ops[0].entity}`);
      const resourceName = `customers/123/${ops[0].entity}s/mock-${crypto.randomUUID()}`;
      mutatedResources.push(resourceName);
      
      // Update existing resources so reconciliation finds them!
      if (ops[0].entity === 'campaign_budget') existingRemoteResources.budget = resourceName;
      if (ops[0].entity === 'campaign') existingRemoteResources.campaign = resourceName;
      if (ops[0].entity === 'ad_group') existingRemoteResources.adGroup = resourceName;
      if (ops[0].entity === 'ad_group_ad') existingRemoteResources.ad = resourceName;
      if (ops[0].entity === 'ad_group_criterion') existingRemoteResources.keyword = resourceName;

      return [{ mutated_resource_name: resourceName }];
    }
  }
  class MockGoogleAdsApi {
    constructor(opts: any) {}
    Customer() { return new MockCustomer(); }
  }
  __setMockGoogleAdsApi(MockGoogleAdsApi);
  __setMockReconciliationApi(MockGoogleAdsApi);

  const tokens = { access_token: encryptCredential('a'), refresh_token: encryptCredential('b') };
  await db.query("INSERT INTO public.integration_credentials (owner_id, provider, encrypted_credentials) VALUES ($1, 'google', $2)", [ownerA, JSON.stringify(tokens)]);

  // Helpers
  const createCampaign = async (budget: number) => {
    const id = crypto.randomUUID();
    await db.query("INSERT INTO public.unified_campaigns (id, owner_id, budget_amount, max_daily_spend, max_campaign_spend) VALUES ($1, $2, $3, $3, $4)", [id, ownerA, budget, budget * 30]);
    return id;
  };

  const createDeployment = async (campId: string, targetState: any) => {
    await db.query("INSERT INTO public.channel_deployments (campaign_id, owner_id, provider, target_state) VALUES ($1, $2, 'google', $3)", [campId, ownerA, JSON.stringify(targetState)]);
  };

  const validTargetState = {
    campaign: { budget: 1000 },
    bidding: { strategy: 'MANUAL_CPC' },
    adGroup: { name: 'Ad Group 1' },
    headlines: [{ current_value: 'H1', owner_approved: true }],
    descriptions: [{ current_value: 'D1', owner_approved: true }],
    keywords: [{ current_value: 'K1', owner_approved: true, match_type: 'EXACT' }],
    destination: { url: 'https://example.com' }
  };

  // TEST: Unapproved creative blocks mutation
  {
    const campId = await createCampaign(1000);
    const state = JSON.parse(JSON.stringify(validTargetState));
    state.headlines[0].owner_approved = false;
    await createDeployment(campId, state);

    let failed = false;
    try { await deployGoogleCampaign(campId, ownerA); } catch (err: any) { failed = err.message.includes('Unapproved'); }
    assert(failed, 'Unapproved creative blocks mutation');
  }

  // TEST: Budget mismatch blocks mutation
  {
    const campId = await createCampaign(2000); // Mismatch with 1000 in target state
    await createDeployment(campId, validTargetState);

    let failed = false;
    try { await deployGoogleCampaign(campId, ownerA); } catch (err: any) { failed = err.message.includes('Budget mismatch'); }
    assert(failed, 'Budget mismatch blocks mutation');
  }

  // TEST: Successful deployment creates resources and marks ACTIVE
  {
    existingRemoteResources = {};
    const campId = await createCampaign(1000);
    await createDeployment(campId, validTargetState);
    mutatedResources = [];
    
    try { await deployGoogleCampaign(campId, ownerA); }
    catch(e) { console.error(e); }
    const audits = await db.query("SELECT details FROM public.audit_logs WHERE action='GOOGLE_RECONCILIATION_COMPLETED'");
    require('fs').writeFileSync('differences.log', JSON.stringify(audits.rows, null, 2));

    const depResult = await db.query("SELECT * FROM public.channel_deployments WHERE campaign_id = $1", [campId]);
    const dep: any = depResult.rows[0];

    assert(dep.status === 'ACTIVE', 'Successful deployment marks ACTIVE');
    assert(mutatedResources.length === 5, 'All 5 resources created (Budget, Campaign, AdGroup, Ad, Keyword)');
    assert(dep.external_state.campaignResourceName.includes('campaign'), 'Resource IDs persisted correctly');
  }

  // TEST: Partial failure stops pipeline and marks FAILED
  {
    existingRemoteResources = {};
    const campId = await createCampaign(1000);
    await createDeployment(campId, validTargetState);
    mutatedResources = [];
    shouldFailAt = 'ad_group';
    
    let failed = false;
    try { await deployGoogleCampaign(campId, ownerA); } catch { failed = true; }
    shouldFailAt = null;

    const depResult = await db.query("SELECT * FROM public.channel_deployments WHERE campaign_id = $1", [campId]);
    const dep: any = depResult.rows[0];

    console.log('Test Partial Failure:', { failed, dep, mutatedResources });

    assert(failed && dep.status === 'FAILED', 'Partial deployment becomes FAILED');
    assert(dep.reconciliation_status === 'REQUIRED', 'Failed deployment becomes RECONCILIATION_REQUIRED');
    assert(mutatedResources.length === 2, 'Pipeline stopped exactly at failure (Budget and Campaign created)');
    assert(dep.external_state.adGroupResourceName === undefined, 'Ad Group ID was NOT persisted');
  }

  // TEST: Idempotency recovery
  {
    existingRemoteResources = { budget: 'budg', campaign: 'camp' };
    const campId = await createCampaign(1000);
    await createDeployment(campId, validTargetState);
    
    // Simulate crash after Campaign
    await db.query("UPDATE public.channel_deployments SET external_state = $1 WHERE campaign_id = $2", 
      [JSON.stringify({ campaignBudgetResourceName: 'budg', campaignResourceName: 'camp' }), campId]);

    mutatedResources = [];
    await deployGoogleCampaign(campId, ownerA);

    assert(mutatedResources.length === 3, 'Crash recovery re-runs only missing steps (AdGroup, Ad, Keyword)');
  }

  // TEST: Audit logs contain no credentials
  {
    const audits = await db.query("SELECT * FROM public.audit_logs");
    const leaks = audits.rows.some(r => JSON.stringify(r).includes('access_token') || JSON.stringify(r).includes('secret'));
    assert(!leaks, 'Audit logs contain no credentials');
  }

  console.log(`\n--- TESTS COMPLETE: ${passCount} PASS, ${failCount} FAIL ---`);
  if (failCount > 0) process.exit(1);
}

runTests().catch(console.error);
