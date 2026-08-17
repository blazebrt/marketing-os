import { PGlite } from '@electric-sql/pglite';
import crypto from 'crypto';

async function runTests() {
  console.log('--- STARTING MILESTONE 4 EXACT SET & TOCTOU TESTS ---');
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
      budget_amount int not null default 1000,
      duration_days int not null default 30,
      creative_id uuid,
      destination text default 'website',
      channels text[] not null,
      status unified_campaign_status not null default 'DRAFT',
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
  await db.query("INSERT INTO public.integrations (owner_id, provider, status) VALUES ($1, 'website', 'connected')", [ownerA]);

  // Test 1: Exact set success
  const campSuccess = crypto.randomUUID();
  await db.query("INSERT INTO public.unified_campaigns (id, owner_id, channels, creative_id, status) VALUES ($1, $2, $3, $4, 'PENDING_APPROVAL')", [campSuccess, ownerA, ['google', 'meta'], creativeA]);
  await db.query("SELECT public.rpc_approve_campaign($1, $2)", [campSuccess, ownerA]);
  
  const { rows: r1 } = await db.query("SELECT status FROM public.unified_campaigns WHERE id=$1", [campSuccess]) as any;
  assert(r1[0].status === 'READY_TO_DEPLOY', 'Exact Google + Meta success');
  
  const { rows: a1 } = await db.query("SELECT action FROM public.audit_logs WHERE resource_id=$1 ORDER BY action", [campSuccess]) as any;
  assert(a1.length === 2 && a1[0].action === 'CAMPAIGN_APPROVED' && a1[1].action === 'CAMPAIGN_STATE_CHANGED', 'Audit log MUST be transactionally consistent');

  // Test 2: Missing integration (TOCTOU prevention)
  const campNoInteg = crypto.randomUUID();
  await db.query("INSERT INTO public.unified_campaigns (id, owner_id, channels, creative_id, status) VALUES ($1, $2, $3, $4, 'PENDING_APPROVAL')", [campNoInteg, ownerA, ['google', 'twitter'], creativeA]);
  try {
    await db.query("SELECT public.rpc_approve_campaign($1, $2)", [campNoInteg, ownerA]);
    assert(false, 'Should fail missing integration');
  } catch (e: any) {
    assert(e.message.includes('Missing connected integration'), 'Missing integration fails TOCTOU inside transaction');
  }

  // Test 3: Unauthorized RPC Caller
  const campUnauth = crypto.randomUUID();
  await db.query("INSERT INTO public.unified_campaigns (id, owner_id, channels, creative_id, status) VALUES ($1, $2, $3, $4, 'PENDING_APPROVAL')", [campUnauth, ownerA, ['google', 'meta'], creativeA]);
  try {
    await db.query("SELECT public.rpc_approve_campaign($1, $2)", [campUnauth, ownerB]);
    assert(false, 'Should fail unauthorized');
  } catch(e:any) {
    assert(e.message.includes('Campaign not found or unauthorized'), 'Owner B cannot exploit the owner UUID parameter / calls RPC with Owner B UUID');
  }

  // Set mock auth.uid to owner B to simulate malicious client sending ownerA's ID
  await db.exec(`create or replace function auth.uid() returns uuid language sql as $$ select '${ownerB}'::uuid; $$;`);
  
  const campUnauth2 = crypto.randomUUID();
  await db.query("INSERT INTO public.unified_campaigns (id, owner_id, channels, creative_id, status) VALUES ($1, $2, $3, $4, 'PENDING_APPROVAL')", [campUnauth2, ownerA, ['google', 'meta'], creativeA]);
  try {
    await db.query("SELECT public.rpc_approve_campaign($1, $2)", [campUnauth2, ownerA]); // Passes ownerA as param, but auth.uid is ownerB
    assert(false, 'Should fail unauthorized auth.uid mismatch');
  } catch(e:any) {
    assert(e.message.includes('Unauthorized: caller UID does not match'), 'Owner B cannot exploit the owner UUID parameter (auth.uid check)');
  }

  console.log(`\n--- TESTS COMPLETE: ${passCount} PASS, ${failCount} FAIL ---`);
}
runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
