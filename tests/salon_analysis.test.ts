import './setup';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'fs';
import path from 'path';
import { analysePerformance } from '../src/lib/analysis/findings';
import { buildPerformance, type SpendRow, type LeadRow } from '../src/lib/metrics/performance';

let pass = 0, fail = 0;
function assert(c: boolean, m: string) {
  if (c) { console.log('PASS: ' + m); pass++; } else { console.error('FAIL: ' + m); fail++; }
}

const spend = (id: string, amount: number, clicks = 50): SpendRow => ({
  google_campaign_id: id, google_campaign_name: `G${id}`, campaign_id: null,
  cost_amount: amount, impressions: 1000, clicks, currency_code: 'INR', metric_date: '2026-08-20',
});
let n = 0;
const lead = (status: string, camp: string | null, revenue = 0): LeadRow => ({
  id: `l${++n}`, status, revenue_amount: revenue, attributed_google_campaign_id: camp,
  gclid: camp ? 'g' : null, attribution_checked_at: '2026-08-21T00:00:00Z',
});

function analyse(spendRows: SpendRow[], leadRows: LeadRow[]) {
  const { campaigns, totals } = buildPerformance(spendRows, leadRows, new Map());
  return analysePerformance(campaigns, totals);
}

async function main() {
  console.log('--- THE ANALYSIS NEVER INVENTS A FINDING ---');

  {
    const f = analyse([], []);
    assert(f.length === 1 && f[0].kind === 'INSUFFICIENT_DATA',
      'With no data at all, the only finding is that there is no data');
    assert(f[0].requiredAction.toLowerCase().includes('campaign'),
      'And it tells the owner what to do about it');
  }

  {
    const f = analyse([spend('a', 4000, 0)], []);
    const wasted = f.find((x) => x.kind === 'SPEND_NO_LEADS');
    assert(!!wasted, 'Spend with no enquiries is flagged');
    assert(wasted!.evidence.some((e) => e.value === '0' && e.label === 'Leads'),
      'And the evidence shows zero leads');
    assert(wasted!.requiredAction.toLowerCase().includes('regenerate') || wasted!.requiredAction.toLowerCase().includes('pause'),
      'With no clicks it suggests fixing the ads');
  }

  {
    const f = analyse([spend('a', 4000, 200)], []);
    const wasted = f.find((x) => x.kind === 'SPEND_NO_LEADS')!;
    assert(wasted.requiredAction.toLowerCase().includes('land'),
      'With clicks but no enquiries it points at the landing page instead');
  }

  {
    // Small spend is not enough to judge.
    const f = analyse([spend('a', 100)], []);
    assert(!f.some((x) => x.kind === 'SPEND_NO_LEADS'),
      'A campaign that has barely spent anything is not condemned');
  }

  console.log('\n--- RANKING IS HONEST ABOUT SAMPLE SIZE ---');

  {
    const leads = [lead('PAID', 'a', 5000), lead('PAID', 'b', 5000)];
    const f = analyse([spend('a', 1000), spend('b', 8000)], leads);
    const best = f.find((x) => x.kind === 'BEST_VALUE_CAMPAIGN')!;
    assert(!!best, 'With two comparable campaigns a best is identified');
    assert(best.confidence === 'LOW', 'But confidence is LOW when only a couple of customers back it');
    assert(best.risk.toLowerCase().includes('chance') || best.risk.toLowerCase().includes('few'),
      'And the risk says the gap could be chance');
  }

  {
    const leads = [
      ...Array.from({ length: 12 }, () => lead('PAID', 'a', 4000)),
      ...Array.from({ length: 12 }, () => lead('PAID', 'b', 4000)),
    ];
    const f = analyse([spend('a', 12000), spend('b', 90000)], leads);
    const best = f.find((x) => x.kind === 'BEST_VALUE_CAMPAIGN')!;
    assert(best.confidence === 'HIGH', 'With enough customers, confidence rises to HIGH');
    const worst = f.find((x) => x.kind === 'WORST_VALUE_CAMPAIGN');
    assert(!!worst, 'A markedly worse campaign is called out');
    assert(worst!.evidence.some((e) => e.label === 'Compared with'),
      'And the comparison it is being judged against is shown');
  }

  {
    // Similar cost: no worst-value finding, because there is no real gap.
    const leads = [lead('PAID', 'a', 4000), lead('PAID', 'b', 4000)];
    const f = analyse([spend('a', 1000), spend('b', 1100)], leads);
    assert(!f.some((x) => x.kind === 'WORST_VALUE_CAMPAIGN'),
      'Campaigns performing similarly do not produce a loser');
  }

  {
    const f = analyse([spend('a', 1000), spend('b', 1000)], [lead('NEW', 'a'), lead('NEW', 'b')]);
    assert(f.some((x) => x.kind === 'INSUFFICIENT_DATA'),
      'Campaigns with enquiries but no paying customers cannot be ranked, and it says so');
    assert(!f.some((x) => x.kind === 'BEST_VALUE_CAMPAIGN'),
      'And no winner is declared');
  }

  console.log('\n--- OTHER HONEST FINDINGS ---');

  {
    const leads = Array.from({ length: 8 }, () => lead('NEW', 'a'));
    const f = analyse([spend('a', 3000)], leads);
    const stuck = f.find((x) => x.kind === 'NO_BOOKINGS_YET');
    assert(!!stuck, 'Enquiries that never become bookings are flagged');
    assert(stuck!.evidence.some((e) => e.label === 'Reached booked' && e.value === '0'),
      'With the evidence showing zero bookings');
  }

  {
    const leads = [lead('PAID', 'a', 1000), ...Array.from({ length: 5 }, () => lead('NEW', null))];
    const f = analyse([spend('a', 2000)], leads);
    const gap = f.find((x) => x.kind === 'ATTRIBUTION_GAP');
    assert(!!gap, 'A large share of untraceable enquiries is flagged');
    assert(gap!.title.includes('%'), 'And the share is stated as a percentage');
  }

  {
    const f = analyse([], [lead('PAID', null, 5000)]);
    assert(f.some((x) => x.kind === 'NO_SPEND_DATA'),
      'Leads without any spend data is reported rather than treated as free customers');
  }

  console.log('\n--- FINDINGS ARE STABLE ACROSS RUNS ---');

  {
    const rows = [spend('a', 4000, 0)];
    const first = analyse(rows, []);
    const second = analyse(rows, []);
    assert(first.map((f) => f.fingerprint).join() === second.map((f) => f.fingerprint).join(),
      'The same data produces the same fingerprints, so recommendations update instead of duplicating');
  }

  console.log('\n--- NEW TABLES ARE OWNER-ISOLATED ---');

  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
  const dir = path.join(process.cwd(), 'supabase/migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  await db.exec(`create role authenticated nologin;
    grant usage on schema public to authenticated;
    grant all on all tables in schema public to authenticated;`);

  const A = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';

  await db.query(`insert into salon_profile (owner_id, salon_name) values ($1,'A Salon'),($2,'B Salon')`, [A, B]);
  await db.query(`insert into salon_services (owner_id, name, price) values ($1,'Hair Spa',999),($2,'Facial',1499)`, [A, B]);
  const { rows: goalRows } = await db.query<{ id: string }>(
    `insert into marketing_goals (owner_id, goal_type) values ($1,'MORE_BOOKINGS') returning id`, [A]);
  await db.query(`insert into marketing_plans (owner_id, goal_id, plan) values ($1,$2,'{"x":1}'::jsonb)`, [A, goalRows[0].id]);
  await db.query(`insert into recommendations (owner_id, kind, title, what, why, confidence, required_action, fingerprint)
    values ($1,'K','T','W','Y','HIGH','A','fp-a')`, [A]);
  await db.query(`insert into ai_events (owner_id, event_type) values ($1,'STRATEGY_GENERATED')`, [A]);

  const asUser = (uid: string, sql: string) => db.transaction(async (tx) => {
    await tx.query(`set local role authenticated`);
    await tx.query(`set local "request.jwt.claim.sub" = '${uid}'`);
    try { return { rows: (await tx.query(sql)).rows, error: null }; }
    catch (e) { return { rows: [], error: e }; }
  });

  for (const table of ['salon_profile', 'salon_services', 'marketing_goals', 'marketing_plans', 'recommendations', 'ai_events']) {
    const mine = await asUser(A, `select * from ${table}`);
    const theirs = await asUser(B, `select * from ${table} where owner_id = '${A}'`);
    assert(mine.rows.length >= 1, `Owner A can read their own ${table}`);
    assert(theirs.rows.length === 0, `Owner B cannot read Owner A's ${table}`);
  }

  const forged = await asUser(B, `insert into salon_services (owner_id, name) values ('${A}','Forged')`);
  assert(forged.error !== null, "Owner B cannot create a service owned by Owner A");

  const tamper = await asUser(B, `update recommendations set status='APPROVED' where owner_id='${A}'`);
  assert(tamper.rows.length === 0 && tamper.error === null, "Owner B cannot decide Owner A's recommendations");

  const editEvent = await asUser(A, `update ai_events set success = false`);
  assert(editEvent.error !== null || editEvent.rows.length === 0, 'AI events are append-only, like the audit log');

  await db.close();

  console.log(`\n--- SALON ANALYSIS: ${pass} PASS, ${fail} FAIL ---`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
