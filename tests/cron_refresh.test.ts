import './setup';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { __setMockServiceClient } from '../src/lib/supabase/service';

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { console.log('PASS: ' + msg); pass++; }
  else { console.error('FAIL: ' + msg); fail++; }
}

/** Minimal awaitable stand-in for the supabase query builder. */
function fakeDb(rows: Record<string, unknown[]>) {
  const make = (table: string): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ['select', 'eq', 'not', 'is', 'gte', 'limit', 'order', 'update', 'upsert']) {
      chain[m] = self;
    }
    chain.single = async () => ({ data: (rows[table] || [])[0] ?? null, error: null });
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows[table] || [], error: null });
    return chain;
  };
  return { from: (t: string) => make(t) };
}

function req(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers });
}

async function main() {
  const { GET } = await import('../src/app/api/cron/refresh-metrics/route');

  console.log('--- THE SCHEDULER ROUTE IS LOCKED ---');

  const originalSecret = process.env.CRON_SECRET;
  __setMockServiceClient(() => fakeDb({ integrations: [] }));

  delete process.env.CRON_SECRET;
  {
    const res = await GET(req('http://localhost/api/cron/refresh-metrics'));
    assert(res.status === 401, 'With no secret configured the route refuses to run at all');
  }
  {
    const res = await GET(req('http://localhost/api/cron/refresh-metrics', {
      authorization: 'Bearer anything',
    }));
    assert(res.status === 401, 'With no secret configured even a bearer token is refused');
  }

  process.env.CRON_SECRET = 'the-real-cron-secret-value';

  {
    const res = await GET(req('http://localhost/api/cron/refresh-metrics'));
    assert(res.status === 401, 'A request with no credentials is refused');
  }
  {
    const res = await GET(req('http://localhost/api/cron/refresh-metrics', {
      authorization: 'Bearer wrong-secret-entirely',
    }));
    assert(res.status === 401, 'A wrong secret is refused');
  }
  {
    // Same length as the real secret: proves the compare is not length-only.
    const res = await GET(req('http://localhost/api/cron/refresh-metrics', {
      authorization: 'Bearer the-real-cron-secret-valuX',
    }));
    assert(res.status === 401, 'A near-miss secret of identical length is refused');
  }
  {
    const res = await GET(req('http://localhost/api/cron/refresh-metrics', {
      authorization: 'Bearer the-real-cron-secret-value',
    }));
    assert(res.status === 200, 'The correct secret is accepted');
    const body = await res.json();
    assert(body.ok === true, 'A successful run reports ok');
    assert(body.accounts === 0, 'With no connected accounts it reports zero accounts');
    assert(Array.isArray(body.failures) && body.failures.length === 0, 'No failures are reported');
    assert(!JSON.stringify(body).includes('the-real-cron-secret'), 'The response never echoes the secret');
  }
  {
    const res = await GET(req('http://localhost/api/cron/refresh-metrics?date=not-a-date', {
      authorization: 'Bearer the-real-cron-secret-value',
    }));
    assert(res.status === 400, 'A malformed date is rejected');
  }
  {
    const res = await GET(req('http://localhost/api/cron/refresh-metrics?date=2026-08-20', {
      authorization: 'Bearer the-real-cron-secret-value',
    }));
    const body = await res.json();
    assert(res.status === 200 && body.date === '2026-08-20', 'A specific day can be re-run');
  }

  __setMockServiceClient(null);
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;

  console.log('\n--- RUNNING TWICE DOES NOT DUPLICATE ROWS ---');

  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  const dir = path.join(process.cwd(), 'supabase/migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  }

  const owner = '11111111-1111-1111-1111-111111111111';
  // Exactly the write the sync performs: upsert on the unique key.
  const upsert = (cost: number) => db.query(
    `insert into campaign_daily_metrics
       (owner_id, google_campaign_id, google_campaign_name, metric_date,
        cost_micros, cost_amount, currency_code, impressions, clicks, conversions)
     values ($1,'555','Bridal','2026-08-20',$2,$3,'INR',100,10,1)
     on conflict (owner_id, google_campaign_id, metric_date) do update
       set cost_micros = excluded.cost_micros,
           cost_amount = excluded.cost_amount,
           impressions = excluded.impressions,
           clicks = excluded.clicks,
           conversions = excluded.conversions,
           updated_at = now()`,
    [owner, cost * 1_000_000, cost]
  );

  await upsert(500);
  await upsert(500);
  await upsert(650);

  const { rows } = await db.query<{ n: string; cost_amount: string }>(
    `select count(*)::text as n, max(cost_amount)::text as cost_amount
       from campaign_daily_metrics where owner_id = $1`, [owner]
  );
  assert(rows[0].n === '1', 'Three runs of the same day leave exactly one row');
  assert(Number(rows[0].cost_amount) === 650, 'The row holds the latest figures, not a sum');

  const dup = await db.query(
    `select 1 from campaign_daily_metrics
      where owner_id=$1 and google_campaign_id='555' and metric_date='2026-08-20'`, [owner]
  );
  assert(dup.rows.length === 1, 'The unique key is what prevents duplication');

  console.log('\n--- METRICS ARE OWNER-ISOLATED ---');

  await db.exec(`
    create role authenticated nologin;
    grant usage on schema public to authenticated;
    grant all on all tables in schema public to authenticated;
  `);
  const other = '22222222-2222-2222-2222-222222222222';
  const asUser = (uid: string, sql: string) => db.transaction(async (tx) => {
    await tx.query(`set local role authenticated`);
    await tx.query(`set local "request.jwt.claim.sub" = '${uid}'`);
    return tx.query(sql);
  });

  const mine = await asUser(owner, `select * from campaign_daily_metrics`);
  assert(mine.rows.length === 1, 'An owner sees their own metrics');
  const theirs = await asUser(other, `select * from campaign_daily_metrics`);
  assert(theirs.rows.length === 0, "Another owner cannot see this owner's spend");

  await db.close();

  console.log(`\n--- CRON REFRESH: ${pass} PASS, ${fail} FAIL ---`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
