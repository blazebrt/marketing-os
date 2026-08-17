// @ts-nocheck
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

async function runTests() {
  console.log('--- STARTING REAL POSTGRES RLS TESTS (PGlite) ---');
  const db = new PGlite();

  // 1. Mock Supabase Auth schema
  // 1. Mock Supabase Auth schema
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ language sql stable;
    
    create role anon;
    create role authenticated;
    create role service_role;
  `);

  // 2. Apply Migration
  let migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/001_initial_marketing.sql'), 'utf-8');
  migration = migration.replace('create extension if not exists pgcrypto;', '');
  
  await db.exec(migration);
  console.log('PASS: Migration 001_initial_marketing.sql applied successfully.');

  // Grant privileges AFTER tables exist
  await db.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    grant all privileges on all tables in schema public to anon, authenticated, service_role;
    grant all privileges on all sequences in schema public to anon, authenticated, service_role;
  `);

  const ownerA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const ownerB = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';

  // Helper to execute queries under a specific role/user
  async function asUser(role: string, uid: string | null, query: string, params: any[] = []) {
    return await db.transaction(async (tx) => {
      await tx.query(`SET LOCAL ROLE ${role};`);
      if (uid) {
        await tx.query(`SET LOCAL "request.jwt.claim.sub" = '${uid}';`);
      } else {
        await tx.query(`SET LOCAL "request.jwt.claim.sub" = '';`);
      }
      try {
        return { data: await tx.query(query, params), error: null };
      } catch (error) {
        return { data: null, error };
      }
    });
  }

  // Seed data as service_role (bypasses RLS)
  await db.query(`
    INSERT INTO public.unified_campaigns (id, owner_id, service, offer, budget_type, budget_amount, max_daily_spend, max_campaign_spend) 
    VALUES 
      ('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', $1, 'Spa', '50%', 'daily', 100, 100, 1000),
      ('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', $2, 'Hair', '20%', 'daily', 200, 200, 2000);
  `, [ownerA, ownerB]);

  console.log('\\n--- EXECUTING RLS TESTS ---');

  // Test 1: Anonymous SELECT denied
  let res = await asUser('anon', null, `SELECT * FROM public.unified_campaigns;`);
  if (res.data && res.data.rows.length === 0) {
    console.log('PASS: Anonymous SELECT denied (returned 0 rows due to RLS).');
  } else {
    console.error('FAIL: Anonymous SELECT:', res.data);
  }

  // Test 2: Anonymous INSERT denied
  res = await asUser('anon', null, `INSERT INTO public.audit_logs (owner_id, actor, action, entity_type) VALUES ('${ownerA}', 'anon', 'test', 'test')`);
  if (res.error) {
    console.log('PASS: Anonymous INSERT denied (' + (res.error as any).message + ').');
  } else {
    console.error('FAIL: Anonymous INSERT succeeded!');
  }

  // Test 3: Owner A can access Owner A rows
  res = await asUser('authenticated', ownerA, `SELECT * FROM public.unified_campaigns;`);
  if (res.data && (res.data as any).rows.length === 1 && (res.data as any).rows[0].owner_id === ownerA) {
    console.log('PASS: Owner A can access Owner A rows.');
  } else {
    console.error('FAIL: Owner A access:', res.data);
  }

  // Test 4: Owner B cannot access Owner A rows
  res = await asUser('authenticated', ownerB, `SELECT * FROM public.unified_campaigns WHERE owner_id = '${ownerA}';`);
  if (res.data && res.data.rows.length === 0) {
    console.log('PASS: Owner B cannot access Owner A rows (returned 0 rows).');
  } else {
    console.error('FAIL: Owner B access:', res.data);
  }

  // Test 5: Owner B cannot UPDATE Owner A rows
  res = await asUser('authenticated', ownerB, `UPDATE public.unified_campaigns SET offer = 'Hacked' WHERE owner_id = '${ownerA}';`);
  // UPDATE in postgres returns success but 0 rows affected if RLS blocks the read/match
  if (res.data && res.data.rowCount === 0) {
    console.log('PASS: Owner B cannot UPDATE Owner A rows (0 rows updated).');
  } else {
    console.error('FAIL: Owner B UPDATE:', res);
  }

  // Test 6: Verify audit_logs behavior
  // Authorized INSERT
  res = await asUser('authenticated', ownerA, `INSERT INTO public.audit_logs (owner_id, actor, action, entity_type) VALUES ('${ownerA}', 'ownerA', 'CREATE', 'campaign') RETURNING id;`);
  if (res.data && res.data.rowCount === 1) {
    console.log('PASS: Authorized audit_logs INSERT works.');
  } else {
    console.error('FAIL: Authorized audit_logs INSERT:', res.error);
  }

  // UPDATE fails
  res = await asUser('authenticated', ownerA, `UPDATE public.audit_logs SET action = 'HACKED';`);
  if (res.error || (res.data && res.data.rowCount === 0)) {
    console.log('PASS: audit_logs UPDATE fails (immutable).');
  } else {
    console.error('FAIL: audit_logs UPDATE succeeded!', res.data);
  }

  // DELETE fails
  res = await asUser('authenticated', ownerA, `DELETE FROM public.audit_logs;`);
  if (res.error || (res.data && res.data.rowCount === 0)) {
    console.log('PASS: audit_logs DELETE fails (immutable).');
  } else {
    console.error('FAIL: audit_logs DELETE succeeded!');
  }

  console.log('\\n--- TESTS COMPLETE ---');
}

runTests().catch(console.error);
