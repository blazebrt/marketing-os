import { PGlite } from '@electric-sql/pglite';
import crypto from 'crypto';
import { generateGoogleCreative } from '../src/lib/providers/google/ai';
import { prepareGoogleDeployment } from '../src/lib/providers/google/adapter';

async function runTests() {
  console.log('--- STARTING MILESTONE 5 ADAPTER TESTS ---');
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
    create type unified_campaign_status as enum ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'READY_TO_DEPLOY', 'FAILED');
    create type channel_deployment_status as enum ('PENDING', 'PREPARING', 'DEPLOYED', 'FAILED', 'PAUSED');

    create table public.unified_campaigns (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      service text not null default 'test',
      offer text not null default 'test',
      budget_type text not null default 'daily',
      budget_amount numeric(15, 2) not null default 1000,
      duration_days int not null default 30,
      max_daily_spend numeric(15, 2) not null default 1000,
      max_campaign_spend numeric(15, 2) not null default 30000,
      destination text not null default 'website',
      channels text[] not null,
      creative_id uuid,
      status unified_campaign_status not null default 'DRAFT',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table public.channel_deployments (
      id uuid primary key default gen_random_uuid(),
      campaign_id uuid not null,
      owner_id uuid not null,
      provider text not null,
      status channel_deployment_status not null default 'PENDING',
      target_state jsonb not null default '{}'::jsonb,
      actual_state jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      unique(campaign_id, provider)
    );

    create table public.creatives (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null
    );

    create table public.creatives_google (
      id uuid primary key default gen_random_uuid(),
      creative_id uuid not null references public.creatives(id) on delete cascade,
      owner_id uuid not null,
      headlines jsonb not null default '[]'::jsonb,
      descriptions jsonb not null default '[]'::jsonb,
      keywords jsonb not null default '[]'::jsonb
    );

    create table public.integrations (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      provider text not null,
      status text not null
    );
  `);

  const ownerA = crypto.randomUUID();
  const creativeA = crypto.randomUUID();

  // Mock Supabase
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: ownerA } } }) },
    from: (table: string) => {
      let queryStr = `SELECT * FROM public.${table}`;
      let conditions: string[] = [];
      let params: any[] = [];
      let isUpdate = false;
      let updateData: any = null;

      const chain = {
        select: (s: string) => chain,
        update: (obj: any) => {
          isUpdate = true;
          updateData = obj;
          return chain;
        },
        eq: (col: string, val: any) => {
          params.push(val);
          conditions.push(`${col}=$${params.length}`);
          return chain;
        },
        single: async () => {
          if (conditions.length > 0) {
            queryStr += ' WHERE ' + conditions.join(' AND ');
          }
          const res = await db.query(queryStr, params);
          return { data: res.rows[0] || null, error: null };
        },
        then: async (resolve: any, reject: any) => {
          // If it's an update, resolve it immediately like a promise
          if (isUpdate) {
            let updateQuery = `UPDATE public.${table} SET target_state=$1, updated_at=$2`;
            let updateParams = [JSON.stringify(updateData.target_state), updateData.updated_at];
            if (conditions.length > 0) {
              updateQuery += ' WHERE ' + conditions.map((c, i) => c.replace(`$${i+1}`, `$${i+3}`)).join(' AND ');
              updateParams.push(...params);
            }
            await db.query(updateQuery, updateParams);
            resolve({ error: null });
          }
        }
      };
      
      // Make chain awaitable
      const proxy = new Proxy(chain, {
        get(target, prop) {
          if (prop === 'then') {
            return isUpdate ? target.then : async (resolve: any) => resolve(await target.single());
          }
          return (target as any)[prop];
        }
      });
      return proxy;
    }
  };

  await db.query('INSERT INTO public.creatives (id, owner_id) VALUES ($1, $2)', [creativeA, ownerA]);
  await db.query("INSERT INTO public.integrations (owner_id, provider, status) VALUES ($1, 'google', 'connected')", [ownerA]);
  
  // AI Generate test
  const gen = generateGoogleCreative({ service: 'Bridal Makeup', offer: '20% Off' });
  assert(gen.keywords[0].ai_generated && !gen.keywords[0].owner_approved, '7. AI keywords start owner_approved=false');
  assert(gen.headlines[0].ai_generated && !gen.headlines[0].owner_approved, '8. AI headlines start owner_approved=false');
  assert(gen.descriptions[0].ai_generated && !gen.descriptions[0].owner_approved, '9. AI descriptions start owner_approved=false');

  const campA = crypto.randomUUID();
  await db.query("INSERT INTO public.unified_campaigns (id, owner_id, channels, creative_id, status) VALUES ($1, $2, $3, $4, 'READY_TO_DEPLOY')", [campA, ownerA, ['google'], creativeA]);
  await db.query("INSERT INTO public.channel_deployments (campaign_id, owner_id, provider, status) VALUES ($1, $2, 'google', 'PENDING')", [campA, ownerA]);
  
  await db.query("INSERT INTO public.creatives_google (creative_id, owner_id, headlines, descriptions, keywords) VALUES ($1, $2, $3, $4, $5)", [
    creativeA, ownerA, JSON.stringify(gen.headlines), JSON.stringify(gen.descriptions), JSON.stringify(gen.keywords)
  ]);

  // Test 10-12: Unapproved blocks
  try {
    await prepareGoogleDeployment(supabase as any, campA);
    assert(false, 'Should block unapproved');
  } catch(e:any) {
    assert(e.message.includes('unapproved'), '10/11/12. Unapproved creative blocks preparation');
  }

  // Approve them
  gen.keywords[0].owner_approved = true;
  gen.keywords[0].current_value = 'bridal makeup lucknow';
  gen.headlines[0].owner_approved = true;
  gen.descriptions[0].owner_approved = true;

  await db.query("UPDATE public.creatives_google SET headlines=$1, descriptions=$2, keywords=$3 WHERE creative_id=$4", [
    JSON.stringify(gen.headlines), JSON.stringify(gen.descriptions), JSON.stringify(gen.keywords), creativeA
  ]);

  // Success 
  let targetState = await prepareGoogleDeployment(supabase as any, campA);
  assert(!!targetState, '13. Approved creative passes preparation');
  assert(targetState.strategyRecommendation.reasons.length > 0, '23. Target state contains strategy reasoning');
  assert(!JSON.stringify(targetState).includes('token'), '24. Target state contains no secrets');
  
  // Idempotency
  let targetState2 = await prepareGoogleDeployment(supabase as any, campA);
  assert(targetState.generatedAt !== targetState2.generatedAt, '25. Re-running preparation is idempotent and replaces target_state');

  // Invalid tests
  gen.keywords[0].current_value = 'x'.repeat(100);
  await db.query("UPDATE public.creatives_google SET keywords=$1 WHERE creative_id=$2", [JSON.stringify(gen.keywords), creativeA]);
  try { await prepareGoogleDeployment(supabase as any, campA); assert(false, 'Should block invalid kw'); } catch(e:any) { assert(e.message.includes('Invalid keyword'), '14. Invalid keyword rejected'); }

  gen.keywords[0].current_value = 'bridal makeup lucknow';
  gen.keywords.push({...gen.keywords[0], id: crypto.randomUUID()});
  await db.query("UPDATE public.creatives_google SET keywords=$1 WHERE creative_id=$2", [JSON.stringify(gen.keywords), creativeA]);
  try { await prepareGoogleDeployment(supabase as any, campA); assert(false, 'Should block duplicate kw'); } catch(e:any) { assert(e.message.includes('Duplicate keyword'), '15. Duplicate keyword rejected'); }

  console.log(`\n--- TESTS COMPLETE: ${passCount} PASS, ${failCount} FAIL ---`);
  if (failCount > 0) process.exit(1);
}
runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
