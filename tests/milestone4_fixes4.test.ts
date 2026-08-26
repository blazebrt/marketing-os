import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import './setup';
import { PGlite } from '@electric-sql/pglite';
import crypto from 'crypto';

async function runTests() {
  console.log('--- STARTING MILESTONE 4 BUDGET & IDENTITY STRICTNESS TESTS ---');
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

  const db = new PGlite();
  
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql as $$ select null::uuid; $$;

    create type unified_campaign_status as enum ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'READY_TO_DEPLOY', 'FAILED');
    
    create table public.unified_campaigns (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      service text default 'test',
      offer text default 'test',
      budget_type text not null,
      budget_amount numeric(15, 2) not null,
      duration_days int not null,
      max_daily_spend numeric(15, 2) not null,
      max_campaign_spend numeric(15, 2) not null,
      max_auto_budget_increase numeric(15, 2) not null default 0,
      destination text not null,
      channels text[] not null,
      creative_id uuid,
      status unified_campaign_status not null default 'DRAFT',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table public.channel_deployments (
      campaign_id uuid not null,
      owner_id uuid not null,
      provider text not null,
      status text not null,
      unique(campaign_id, provider)
    );

    create table public.creatives (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null
    );

    create table public.integrations (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      provider text not null,
      status text not null
    );

    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      action text not null,
      resource_type text,
      resource_id text,
      details jsonb
    );
  `);

  // LOAD RPC
  const rpcCode = require('fs').readFileSync('supabase/migrations/008_milestone4_rpc_v2.sql', 'utf8');
  await db.exec(rpcCode);

  const ownerA = crypto.randomUUID();
  const ownerB = crypto.randomUUID();
  const creativeA = crypto.randomUUID();

  await db.query('INSERT INTO public.creatives (id, owner_id) VALUES ($1, $2)', [creativeA, ownerA]);
  await db.query("INSERT INTO public.integrations (owner_id, provider, status) VALUES ($1, 'google', 'connected')", [ownerA]);
  await db.query("INSERT INTO public.integrations (owner_id, provider, status) VALUES ($1, 'meta', 'connected')", [ownerA]);

  // Function to insert campaign and return ID
  const insertCamp = async (
    bType: string, bAmount: number, bDuration: number, 
    daily: number, total: number, inc: number
  ) => {
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO public.unified_campaigns (id, owner_id, budget_type, budget_amount, duration_days, max_daily_spend, max_campaign_spend, max_auto_budget_increase, channels, creative_id, destination, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDING_APPROVAL')`,
      [id, ownerA, bType, bAmount, bDuration, daily, total, inc, ['google', 'meta'], creativeA, 'https://example.com']
    );
    return id;
  };

  // IDENTITY TESTS
  const campAuth = await insertCamp('daily', 1000, 30, 1000, 30000, 0);
  
  // 1. anonymous RPC rejected
  try {
    await db.query("SELECT public.rpc_approve_campaign($1, $2)", [campAuth, ownerA]);
    assert(false, 'Should fail anon');
  } catch(e:any) {
    assert(e.message.includes('Unauthorized: No authenticated user'), 'Anonymous RPC rejected');
  }

  // Inject auth.uid = ownerB
  await db.exec(`create or replace function auth.uid() returns uuid language sql as $$ select '${ownerB}'::uuid; $$`);

  // 2. Owner B cannot use Owner A ID
  try {
    await db.query("SELECT public.rpc_approve_campaign($1, $2)", [campAuth, ownerA]);
    assert(false, 'Should fail mismatch');
  } catch(e:any) {
    assert(e.message.includes('Unauthorized: Caller UID does not match requested owner_id'), 'Owner B cannot use Owner A ID');
  }

  // 3. Owner B cannot use their own ID against Owner A campaign
  try {
    await db.query("SELECT public.rpc_approve_campaign($1, $2)", [campAuth, ownerB]);
    assert(false, 'Should fail not found');
  } catch(e:any) {
    assert(e.message.includes('Campaign not found or unauthorized'), 'Owner B cannot use their own ID against Owner A campaign');
  }

  // Inject auth.uid = ownerA
  await db.exec(`create or replace function auth.uid() returns uuid language sql as $$ select '${ownerA}'::uuid; $$`);

  // 4. Owner A succeeds
  await db.query("SELECT public.rpc_approve_campaign($1, $2)", [campAuth, ownerA]);
  assert(true, 'Owner A succeeds');

  // BUDGET TESTS
  const expectFail = async (id: string, match: string, msg: string) => {
    try {
      await db.query("SELECT public.rpc_approve_campaign($1, $2)", [id, ownerA]);
      assert(false, `Should fail: ${msg}`);
    } catch (e:any) {
      assert(e.message.includes(match), msg);
    }
  };

  // Negative budget
  const campNeg = await insertCamp('daily', -100, 30, -100, -3000, 0);
  await expectFail(campNeg, 'Negative or zero budget', 'Negative budget fails');

  // Zero budget
  const campZero = await insertCamp('daily', 0, 30, 0, 0, 0);
  await expectFail(campZero, 'Negative or zero budget', 'Zero budget fails');

  // Invalid budget type
  const campType = await insertCamp('weekly', 1000, 30, 1000, 30000, 0);
  await expectFail(campType, 'Invalid budget type', 'Invalid budget type fails');

  // Invalid duration
  const campDur = await insertCamp('daily', 1000, 0, 1000, 0, 0);
  await expectFail(campDur, 'Invalid duration', 'Invalid duration fails');

  // Tampered max_daily_spend
  const campTamperDaily = await insertCamp('daily', 1000, 30, 2000, 30000, 0);
  await expectFail(campTamperDaily, 'Tampered max_daily_spend', 'Tampered max_daily_spend fails');

  // Tampered max_campaign_spend
  const campTamperTotal = await insertCamp('daily', 1000, 30, 1000, 50000, 0);
  await expectFail(campTamperTotal, 'Tampered max_campaign_spend', 'Tampered max_campaign_spend fails');

  // Tampered max_auto_budget_increase
  const campTamperInc = await insertCamp('daily', 1000, 30, 1000, 30000, 100);
  await expectFail(campTamperInc, 'Tampered max_auto_budget_increase', 'Tampered max_auto_budget_increase fails');

  // Absolute safety ceilings
  const campCeilDaily = await insertCamp('daily', 60000, 2, 60000, 120000, 0);
  await expectFail(campCeilDaily, 'Daily spend exceeds safety limit', 'Budget above absolute daily safety ceiling fails');

  const campCeilTotal = await insertCamp('total', 600000, 30, 20000, 600000, 0);
  await expectFail(campCeilTotal, 'Total spend exceeds safety limit', 'Budget above absolute total safety ceiling fails');

  // Valid limits pass (total type)
  const campValidTotal = await insertCamp('total', 30000, 30, 1000, 30000, 0);
  await db.query("SELECT public.rpc_approve_campaign($1, $2)", [campValidTotal, ownerA]);
  assert(true, 'Valid limits pass (total)');

  console.log(`\n--- TESTS COMPLETE: ${passCount} PASS, ${failCount} FAIL ---`);
}
runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
