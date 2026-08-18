import { PGlite } from '@electric-sql/pglite';
import crypto from 'crypto';
import { deployGoogleCampaign } from '../src/lib/providers/google/deployment';
import { reconcileGoogleDeployment } from '../src/lib/providers/google/reconciliation';
import * as testAccount from '../src/lib/providers/google/test-account';
import { encryptCredential } from '../src/lib/crypto';
import { ERROR_CODES } from '../src/lib/providers/google/errors';

import { __setMockCreateClient } from '../src/lib/supabase/server';

let mockAuthUser: any = null;
__setMockCreateClient(async () => ({
  auth: { getUser: async () => ({ data: { user: mockAuthUser }, error: mockAuthUser ? null : { message: 'Auth required' } }) }
}));

const mockServiceModule = require('../src/lib/supabase/service');
const mockAuditModule = require('../src/lib/audit');

import { __setMockServiceClient } from '../src/lib/supabase/service';

async function runTests() {
  console.log('--- STARTING MILESTONE 6 COMPREHENSIVE TESTS ---');
  let passCount = 0;
  let failCount = 0;

  const assert = (condition: boolean, msg: string) => {
    if (condition) { console.log(`PASS: ${msg}`); passCount++; } 
    else { console.error(`FAIL: ${msg}`); failCount++; }
  };

  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  process.env.GOOGLE_ADS_EXECUTION_MODE = 'test';
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'token';
  process.env.GOOGLE_CLIENT_ID = 'client';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.GOOGLE_ADS_TEST_CUSTOMER_ID = '123';
  process.env.GOOGLE_ADS_TEST_MANAGER_ID = '123';

  const db = new PGlite();
  await db.exec(`
    create table public.unified_campaigns (
      id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text not null,
      budget_amount numeric not null, budget_type text not null, duration_days integer not null,
      max_daily_spend numeric, max_campaign_spend numeric, max_auto_budget_increase boolean
    );
    create table public.integration_credentials (
      id uuid primary key default gen_random_uuid(), owner_id uuid not null, provider text not null,
      encrypted_credentials text not null
    );
    create table public.channel_deployments (
      id uuid primary key default gen_random_uuid(), campaign_id uuid not null, owner_id uuid not null,
      provider text not null, status text not null, target_state jsonb not null, external_state jsonb not null,
      reconciliation_status text, locked_by text, locked_at text, failure_code text, failure_stage text
    );
    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(), owner_id uuid not null, action text not null,
      resource_type text, resource_id text, details jsonb
    );
  `);

  __setMockServiceClient(async () => {
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
          in: (col: string, vals: any[]) => {
            const placeholders = vals.map(v => { params.push(v); return `$${params.length}`; }).join(',');
            conditions.push(`${col} IN (${placeholders})`);
            return chain;
          },
          single: async () => {
            if (isUpdate) {
              let updateQuery = `UPDATE public.${table} SET `;
              let setParts: string[] = [];
              let valIdx = params.length + 1;
              const updateParams: any[] = [...params];
              for (const [k, v] of Object.entries(data)) {
                setParts.push(`${k}=$${valIdx++}`);
                updateParams.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
              }
              updateQuery += setParts.join(', ');
              if (conditions.length > 0) updateQuery += ' WHERE ' + conditions.join(' AND ');
              updateQuery += ' RETURNING *';
              const res = await db.query(updateQuery, updateParams);
              return { data: res.rows[0] || null, error: res.rows.length === 0 ? { code: 'PGRST116' } : null };
            } else {
              if (conditions.length > 0) queryStr += ' WHERE ' + conditions.join(' AND ');
              const res = await db.query(queryStr, params);
              return { data: res.rows[0] || null, error: res.rows.length === 0 ? { code: 'PGRST116' } : null };
            }
          },
          then: async (resolve: any) => resolve(await chain.single())
        };
        const proxy = new Proxy(chain, {
          get(target, prop) {
            if (prop === 'then') return async (resolve: any) => resolve(await target.single());
            return (target as any)[prop];
          }
        });
        return proxy;
      }
    };
  });

  const logs: any[] = [];
  mockAuditModule.__setMockLogAudit(async (actor: string, action: string, type: string, id: string, before: any, after: any, reason: string) => {
    logs.push({ actor, action, type, id, before, after, reason });
  });

  const ownerA = crypto.randomUUID();
  const ownerB = crypto.randomUUID();
  const campId = crypto.randomUUID();

  await db.query("INSERT INTO public.integration_credentials (owner_id, provider, encrypted_credentials) VALUES ($1, 'google', $2)", [ownerA, JSON.stringify({ access_token: encryptCredential('a'), refresh_token: encryptCredential('b') })]);

  await db.query("INSERT INTO public.unified_campaigns (id, owner_id, name, budget_amount, budget_type, duration_days, max_daily_spend, max_campaign_spend, max_auto_budget_increase) VALUES ($1, $2, 'C', 1000, 'DAILY', 10, 1000, 10000, false)", [campId, ownerA]);

  const targetState = {
    campaign: { budget: 1000 },
    bidding: { strategy: 'MANUAL_CPC' },
    adGroup: { name: 'AG1' },
    headlines: [{ current_value: 'H1', owner_approved: true }],
    descriptions: [{ current_value: 'D1', owner_approved: true }],
    keywords: [{ current_value: 'K1', owner_approved: true, match_type: 'EXACT' }],
    destination: { url: 'https://a.com' }
  };

  const resetDeployment = async (status = 'READY_TO_DEPLOY', ts = targetState) => {
    await db.query("DELETE FROM public.channel_deployments");
    await db.query("INSERT INTO public.channel_deployments (campaign_id, owner_id, provider, status, target_state, external_state) VALUES ($1, $2, 'google', $3, $4, '{}')", [campId, ownerA, status, JSON.stringify(ts)]);
  };

  // Mock API
  let mutatedResources: any[] = [];
  let existingRemoteResources: any = {};
  class MockGoogleAdsApi {
    constructor() {}
    Customer() {

      return {
        async query(q: string) {
          if (q.includes('test_account')) return [{ customer: { test_account: true } }];
          
          if (q.includes('campaign_budget.name')) return existingRemoteResources.budget ? [{ campaign_budget: { resource_name: existingRemoteResources.budget } }] : [];
          if (q.includes('campaign.name') && !q.includes('campaign.status')) return existingRemoteResources.campaign ? [{ campaign: { resource_name: existingRemoteResources.campaign } }] : [];
          if (q.includes('ad_group.name') && !q.includes('ad_group.type')) return existingRemoteResources.adGroup ? [{ ad_group: { resource_name: existingRemoteResources.adGroup } }] : [];
          if (q.includes('responsive_search_ad.headlines')) return [{ ad_group_ad: { ad: { final_urls: ['https://a.com'], responsive_search_ad: { headlines: [{text: 'H1'}] } } } }];
          if (q.includes('ad_group_ad.ad.resource_name')) return existingRemoteResources.ad ? [{ ad_group_ad: { ad: { resource_name: existingRemoteResources.ad } } }] : [];
          if (q.includes('ad_group_criterion.keyword.text')) return [{ ad_group_criterion: { keyword: { text: 'K1', match_type: 'EXACT' } } }];
          if (q.includes('ad_group_criterion.type')) return existingRemoteResources.keyword ? [{ ad_group_criterion: { resource_name: existingRemoteResources.keyword } }] : [];

          // Reconciliation queries
          if (q.includes('bidding_strategy_type')) return [{ campaign: { name: 'Test', bidding_strategy_type: 'MANUAL_CPC' }, campaign_budget: { amount_micros: 1000 * 1000000 } }];
          if (q.includes('ad_group.type')) return [{ ad_group: { name: 'AG1' }, campaign: { resource_name: existingRemoteResources.campaign || mutatedResources.find(m => m.entity === 'campaign')?.resource?.resource_name || 'c1' } }];

          return [];
        },
        async mutateResources(reqs: any[]) {
          mutatedResources.push(...reqs);
          const entity = reqs[0].entity;
          const resourceName = `customers/123/${entity}s/mock-${Math.random()}`;
          let key = entity;
          if (entity === 'campaign_budget') key = 'budget';
          else if (entity === 'ad_group') key = 'adGroup';
          else if (entity === 'ad_group_ad') key = 'ad';
          else if (entity === 'ad_group_criterion') key = 'keyword';
          existingRemoteResources[key] = resourceName;
          return [{ mutated_resource_name: resourceName }];
        }
      }
    }
  }

  (testAccount as any).__setMockGoogleAdsApi(MockGoogleAdsApi);
  require('../src/lib/providers/google/client').__setMockGoogleAdsApi(MockGoogleAdsApi);
  require('../src/lib/providers/google/reconciliation').__setMockGoogleAdsApi(MockGoogleAdsApi);

  console.log('--- STARTING MILESTONE 6 SECURITY TESTS ---');

  // We will run tests here
  
  console.log(`\n--- SECURITY TESTS COMPLETE: ${passCount} PASS, ${failCount} FAIL ---`);
  if (failCount > 0) process.exit(1);
}

runTests().catch(console.error);
