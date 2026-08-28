import './setup';
import {
  buildPerformance,
  rankByCostPerPayingCustomer,
  safeRatio,
  reachedStage,
  UNTRACEABLE_KEY,
  type SpendRow,
  type LeadRow,
} from '../src/lib/metrics/performance';
import { microsToAmount, yesterdayIso } from '../src/lib/providers/google/reporting';
import { campaignIdFromResourceName } from '../src/lib/metrics/sync';
import { formatMoney, formatMultiple } from '../src/lib/metrics/format';

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { console.log('PASS: ' + msg); pass++; }
  else { console.error('FAIL: ' + msg); fail++; }
}

const spend = (id: string, amount: number, extra: Partial<SpendRow> = {}): SpendRow => ({
  google_campaign_id: id,
  google_campaign_name: `Google ${id}`,
  campaign_id: null,
  cost_amount: amount,
  impressions: 100,
  clicks: 10,
  currency_code: 'INR',
  metric_date: '2026-08-20',
  ...extra,
});

let leadSeq = 0;
const lead = (status: string, campaignId: string | null, revenue = 0, extra: Partial<LeadRow> = {}): LeadRow => ({
  id: `lead-${++leadSeq}`,
  status,
  revenue_amount: revenue,
  attributed_google_campaign_id: campaignId,
  gclid: campaignId ? 'gclid-x' : null,
  attribution_checked_at: '2026-08-21T00:00:00Z',
  ...extra,
});

async function main() {
  console.log('--- UNITS AND HELPERS ---');

  assert(microsToAmount(1_000_000) === 1, 'One million micros is one rupee');
  assert(microsToAmount(12_345_678) === 12.35, 'Micros convert to rupees rounded to paise');
  assert(microsToAmount(0) === 0, 'Zero micros is zero rupees');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(yesterdayIso(new Date('2026-08-27T04:00:00Z'))), 'Yesterday is a plain date');
  assert(yesterdayIso(new Date('2026-03-01T04:00:00Z')) === '2026-02-28', 'Yesterday crosses a month boundary');
  assert(
    campaignIdFromResourceName('customers/1234567890/campaigns/987654321') === '987654321',
    'Google campaign id is recovered from the resource name'
  );
  assert(campaignIdFromResourceName(null) === null, 'A missing resource name yields no campaign id');

  console.log('\n--- NO MISLEADING RATIOS ---');

  assert(safeRatio(100, 0) === null, 'Dividing by zero gives no data, not Infinity');
  assert(safeRatio(null, 5) === null, 'An unknown numerator gives no data');
  assert(safeRatio(0, 5) === 0, 'A genuine zero numerator is still a real answer');
  assert(safeRatio(100, 4) === 25, 'A normal ratio is computed');
  assert(formatMoney(null) === 'No data yet', 'Missing money reads as "No data yet"');
  assert(formatMultiple(null) === 'No data yet', 'Missing return reads as "No data yet"');

  console.log('\n--- FUNNEL STAGES ---');

  assert(reachedStage('PAID', 'BOOKED'), 'A paying lead counts as having reached Booked');
  assert(reachedStage('VISITED', 'BOOKED'), 'A visited lead counts as having reached Booked');
  assert(!reachedStage('CONTACTED', 'BOOKED'), 'A contacted lead has not reached Booked');
  assert(!reachedStage('LOST', 'BOOKED'), 'A lost lead is not credited with earlier stages');
  assert(!reachedStage('UNKNOWN', 'BOOKED'), 'An unknown lead is not credited with earlier stages');

  console.log('\n--- SPEND WITH NO LEADS IS FLAGGED ---');

  {
    const { campaigns } = buildPerformance([spend('111', 5000)], [], new Map());
    const row = campaigns.find((c) => c.googleCampaignId === '111')!;
    assert(row.spendWithNoLeads === true, 'A campaign that spent money and got nothing is flagged');
    assert(row.costPerLead === null, 'Cost per lead is withheld when there are no leads');
    assert(row.costPerPayingCustomer === null, 'Cost per customer is withheld when nobody paid');
    assert(row.returnOnSpend === null, 'Return is withheld when there is no revenue');
    assert(row.spend === 5000, 'Spend itself is still reported');
  }

  console.log('\n--- LEADS WITH NO SPEND ---');

  {
    const { campaigns } = buildPerformance([], [lead('NEW', '222')], new Map());
    const row = campaigns.find((c) => c.googleCampaignId === '222')!;
    assert(row.spend === null, 'Spend reads as unknown when Google has reported nothing');
    assert(row.costPerLead === null, 'Cost per lead is withheld when spend is unknown');
    assert(row.spendWithNoLeads === false, 'Unknown spend is not reported as wasted spend');
  }

  console.log('\n--- A FULL CAMPAIGN ---');

  {
    const rows = [spend('333', 10000, { campaign_id: 'camp-a' })];
    const leads = [
      lead('NEW', '333'),
      lead('CONTACTED', '333'),
      lead('BOOKED', '333'),
      lead('VISITED', '333'),
      lead('PAID', '333', 8000),
      lead('PAID', '333', 12000),
      lead('LOST', '333'),
    ];
    const { campaigns, totals } = buildPerformance(rows, leads, new Map([['camp-a', 'Bridal Makeup']]));
    const row = campaigns.find((c) => c.googleCampaignId === '333')!;

    assert(row.name === 'Bridal Makeup', 'The campaign uses the name from this app, not Google');
    assert(row.linkedToApp === true, 'A campaign created here is marked as linked');
    assert(row.leads === 7, 'Every lead is counted');
    assert(row.booked === 4, 'Booked counts everyone at Booked or beyond, excluding Lost');
    assert(row.visited === 3, 'Visited counts everyone at Visited or beyond');
    assert(row.paid === 2, 'Paid counts only paying customers');
    assert(row.revenue === 20000, 'Revenue sums only paying customers');
    assert(row.costPerLead === Math.round((10000 / 7) * 100) / 100, 'Cost per lead divides spend by all leads');
    assert(row.costPerPayingCustomer === 5000, 'Cost per paying customer divides spend by payers');
    assert(row.returnOnSpend === 2, 'Return is revenue divided by spend');
    assert(totals.leads === 7 && totals.paying === 2 && totals.revenue === 20000, 'Totals aggregate correctly');
  }

  console.log('\n--- UNTRACEABLE LEADS ARE THEIR OWN GROUP ---');

  {
    const leads = [
      lead('PAID', '444', 5000),
      lead('NEW', null),
      lead('PAID', null, 9000),
      lead('NEW', null, 0, { gclid: 'g-pending', attribution_checked_at: null }),
    ];
    const { campaigns, totals } = buildPerformance([spend('444', 2000)], leads, new Map());
    const bucket = campaigns.find((c) => c.key === UNTRACEABLE_KEY)!;

    assert(!!bucket, 'Untraceable leads get their own row');
    assert(bucket.leads === 3, 'All untraceable leads land in that row');
    assert(bucket.spend === null, 'The untraceable row claims no spend');
    assert(bucket.costPerLead === null, 'No cost per lead is invented for untraceable leads');
    assert(bucket.revenue === 9000, 'Their revenue is still counted');
    assert(campaigns[campaigns.length - 1].key === UNTRACEABLE_KEY, 'The untraceable row sorts last');
    assert(totals.untraceableLeads === 3, 'Untraceable leads are reported in the totals');
    assert(totals.leadsAwaitingAttribution === 1, 'Leads still awaiting tonight\'s lookup are counted separately');
    assert(totals.leads === 4, 'Untraceable leads still count towards total leads');
    assert(totals.revenue === 14000, 'Untraceable revenue still counts towards total revenue');
  }

  console.log('\n--- BEST AND WORST ---');

  {
    const rows = [spend('a', 1000), spend('b', 9000), spend('c', 500)];
    const leads = [
      lead('PAID', 'a', 3000),
      lead('PAID', 'b', 3000),
      lead('NEW', 'c'),
    ];
    const { campaigns } = buildPerformance(rows, leads, new Map());
    const { best, worst, rankable } = rankByCostPerPayingCustomer(campaigns);

    assert(best?.googleCampaignId === 'a', 'The cheapest paying customer wins');
    assert(worst?.googleCampaignId === 'b', 'The most expensive paying customer loses');
    assert(rankable === 2, 'Only campaigns with spend and a payer can be ranked');
    assert(!campaigns.some((c) => c.googleCampaignId === 'c' && c.costPerPayingCustomer !== null),
      'A campaign with no paying customer has no cost per customer');
  }

  {
    const { campaigns } = buildPerformance([spend('solo', 100)], [lead('PAID', 'solo', 500)], new Map());
    const { best, worst } = rankByCostPerPayingCustomer(campaigns);
    assert(best !== null, 'A single rankable campaign is still reported as best');
    assert(worst === null, 'With only one rankable campaign there is no worst to compare');
  }

  {
    const { campaigns } = buildPerformance([spend('x', 100)], [], new Map());
    const { best, worst, rankable } = rankByCostPerPayingCustomer(campaigns);
    assert(best === null && worst === null && rankable === 0, 'With nothing rankable, both are absent');
  }

  console.log(`\n--- PERFORMANCE METRICS: ${pass} PASS, ${fail} FAIL ---`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
