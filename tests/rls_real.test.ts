import './setup';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'fs';
import path from 'path';

// Proves, against a real Postgres engine, that one business owner cannot reach
// another owner's data. Runs the shipped migrations unmodified: if a policy is
// ever dropped or loosened, this test fails.

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log('PASS: ' + message);
    passCount++;
  } else {
    console.error('FAIL: ' + message);
    failCount++;
  }
}

async function runTests() {
  console.log('--- STARTING REAL POSTGRES RLS TESTS (PGlite) ---');
  const db = new PGlite({ extensions: { pgcrypto } });

  // 1. Stand in for the Supabase auth schema and the roles PostgREST uses.
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ language sql stable;

    create role anon;
    create role authenticated;
    create role service_role;
  `);

  // 2. Apply every shipped migration, in order, unmodified.
  const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
  const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of migrationFiles) {
    await db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf-8'));
  }
  assert(migrationFiles.length > 0, `Migrations applied successfully (${migrationFiles.join(', ')})`);

  // Grant table privileges AFTER tables exist. RLS is what must do the
  // filtering here -- deliberately not withheld privileges.
  await db.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    grant all privileges on all tables in schema public to anon, authenticated, service_role;
    grant all privileges on all sequences in schema public to anon, authenticated, service_role;
  `);

  const ownerA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const ownerB = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
  const campaignA = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  async function asUser(role: string, uid: string | null, query: string, params: any[] = []) {
    return await db.transaction(async (tx) => {
      await tx.query(`SET LOCAL ROLE ${role};`);
      await tx.query(`SET LOCAL "request.jwt.claim.sub" = '${uid ?? ''}';`);
      try {
        return { data: await tx.query(query, params), error: null };
      } catch (error) {
        return { data: null, error };
      }
    });
  }

  // Seed both owners' data as superuser, which bypasses RLS.
  await db.query(`
    INSERT INTO public.unified_campaigns
      (id, owner_id, service, offer, budget_type, budget_amount, duration_days,
       max_daily_spend, max_campaign_spend, channels)
    VALUES
      ($3, $1, 'Spa', '50%', 'daily', 100, 10, 100, 1000, array['google']),
      ('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', $2, 'Hair', '20%', 'daily', 200, 10, 200, 2000, array['meta']);
  `, [ownerA, ownerB, campaignA]);

  await db.query(`
    INSERT INTO public.leads (owner_id, name, phone, normalized_phone, status, revenue_amount)
    VALUES ($1, 'Asha (owner A)', '+91 90000 00001', '919000000001', 'NEW', 0),
           ($2, 'Bhavna (owner B)', '+91 90000 00002', '919000000002', 'NEW', 0);
  `, [ownerA, ownerB]);

  await db.query(`
    INSERT INTO public.integration_credentials (owner_id, provider, encrypted_credentials)
    VALUES ($1, 'google', 'OWNER-A-SECRET'), ($2, 'google', 'OWNER-B-SECRET');
  `, [ownerA, ownerB]);

  await db.query(`
    INSERT INTO public.oauth_states (owner_id, provider, state_hash, expires_at)
    VALUES ($1, 'google', 'owner-a-state', now() + interval '10 minutes');
  `, [ownerA]);

  console.log('\n--- CAMPAIGNS ---');

  let res = await asUser('anon', null, `SELECT * FROM public.unified_campaigns;`);
  assert(res.data?.rows.length === 0, 'Anonymous SELECT on campaigns denied (0 rows due to RLS).');

  res = await asUser('anon', null,
    `INSERT INTO public.audit_logs (owner_id, actor, action, entity_type) VALUES ('${ownerA}', 'anon', 'test', 'test')`);
  assert(res.error !== null, 'Anonymous INSERT into audit_logs denied.');

  res = await asUser('authenticated', ownerA, `SELECT * FROM public.unified_campaigns;`);
  assert(res.data?.rows.length === 1 && (res.data.rows[0] as any).owner_id === ownerA,
    'Owner A sees exactly their own campaign.');

  res = await asUser('authenticated', ownerB, `SELECT * FROM public.unified_campaigns WHERE owner_id = '${ownerA}';`);
  assert(res.data?.rows.length === 0, "Owner B cannot read Owner A's campaigns.");

  res = await asUser('authenticated', ownerB, `UPDATE public.unified_campaigns SET offer = 'Hacked' WHERE owner_id = '${ownerA}';`);
  assert(res.data?.rowCount === 0, "Owner B cannot UPDATE Owner A's campaigns (0 rows affected).");

  res = await asUser('authenticated', ownerB, `DELETE FROM public.unified_campaigns WHERE owner_id = '${ownerA}';`);
  assert(res.data?.rowCount === 0, "Owner B cannot DELETE Owner A's campaigns.");

  res = await asUser('authenticated', ownerB,
    `INSERT INTO public.unified_campaigns
       (owner_id, service, offer, budget_type, budget_amount, duration_days,
        max_daily_spend, max_campaign_spend, channels)
     VALUES ('${ownerA}', 'Forged', 'x', 'daily', 1, 1, 1, 1, array['google']);`);
  assert(res.error !== null, 'Owner B cannot INSERT a campaign owned by Owner A.');

  console.log('\n--- LEADS ---');

  res = await asUser('anon', null, `SELECT * FROM public.leads;`);
  assert(res.data?.rows.length === 0, 'Anonymous SELECT on leads denied.');

  res = await asUser('authenticated', ownerA, `SELECT * FROM public.leads;`);
  assert(res.data?.rows.length === 1 && (res.data.rows[0] as any).owner_id === ownerA,
    'Owner A sees exactly their own leads.');

  res = await asUser('authenticated', ownerB, `SELECT * FROM public.leads WHERE owner_id = '${ownerA}';`);
  assert(res.data?.rows.length === 0, "Owner B cannot read Owner A's leads.");

  res = await asUser('authenticated', ownerB,
    `UPDATE public.leads SET revenue_amount = 999999 WHERE owner_id = '${ownerA}';`);
  assert(res.data?.rowCount === 0, "Owner B cannot UPDATE Owner A's leads.");

  console.log('\n--- CREDENTIALS (service-role only) ---');

  res = await asUser('anon', null, `SELECT * FROM public.integration_credentials;`);
  assert(res.data?.rows.length === 0, 'Anonymous cannot read stored credentials.');

  res = await asUser('authenticated', ownerA, `SELECT * FROM public.integration_credentials;`);
  assert(res.data?.rows.length === 0,
    'A signed-in owner cannot read stored credentials -- not even their own.');

  res = await asUser('authenticated', ownerB, `SELECT * FROM public.integration_credentials WHERE owner_id = '${ownerA}';`);
  assert(res.data?.rows.length === 0, "Owner B cannot read Owner A's credentials.");

  res = await asUser('authenticated', ownerB,
    `INSERT INTO public.integration_credentials (owner_id, provider, encrypted_credentials)
     VALUES ('${ownerB}', 'meta', 'x');`);
  assert(res.error !== null, 'A signed-in owner cannot write credentials.');

  res = await asUser('authenticated', ownerA, `SELECT * FROM public.oauth_states;`);
  assert(res.data?.rows.length === 0, 'A signed-in owner cannot read OAuth state records.');

  console.log('\n--- AUDIT LOG IMMUTABILITY ---');

  res = await asUser('authenticated', ownerA,
    `INSERT INTO public.audit_logs (owner_id, actor, action, entity_type) VALUES ('${ownerA}', 'ownerA', 'CREATE', 'campaign') RETURNING id;`);
  assert(res.data?.rowCount === 1, 'Authorized audit_logs INSERT works.');

  res = await asUser('authenticated', ownerA, `UPDATE public.audit_logs SET action = 'HACKED';`);
  assert(res.error !== null || res.data?.rowCount === 0, 'audit_logs UPDATE fails (immutable).');

  res = await asUser('authenticated', ownerA, `DELETE FROM public.audit_logs;`);
  assert(res.error !== null || res.data?.rowCount === 0, 'audit_logs DELETE fails (immutable).');

  res = await asUser('authenticated', ownerB, `SELECT * FROM public.audit_logs WHERE owner_id = '${ownerA}';`);
  assert(res.data?.rows.length === 0, "Owner B cannot read Owner A's audit log.");

  await db.close();

  console.log(`\n--- RLS TESTS COMPLETE: ${passCount} PASS, ${failCount} FAIL ---`);
  if (failCount > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
