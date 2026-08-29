import type { CampaignPerformance, PerformanceTotals } from '@/lib/metrics/performance';

/**
 * Deterministic performance analysis.
 *
 * Every finding here is computed in ordinary code from measured figures. The AI
 * is only ever asked to WORD a finding, never to decide whether one exists, so
 * it cannot invent a winner, a loser, or a number.
 *
 * Findings carry the evidence that produced them and a confidence derived from
 * how much data stands behind them.
 */

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type Finding = {
  /** Stable identity so re-running analysis updates rather than duplicates. */
  fingerprint: string;
  kind:
    | 'SPEND_NO_LEADS'
    | 'NO_BOOKINGS_YET'
    | 'BEST_VALUE_CAMPAIGN'
    | 'WORST_VALUE_CAMPAIGN'
    | 'ATTRIBUTION_GAP'
    | 'INSUFFICIENT_DATA'
    | 'NO_SPEND_DATA';
  title: string;
  /** Machine-checkable evidence. Shown to the owner verbatim. */
  evidence: { label: string; value: string }[];
  confidence: Confidence;
  campaignKey: string | null;
  requiredAction: string;
  expectedImpact: string;
  risk: string;
};

/** Below this many leads, differences between campaigns are noise. */
const MIN_LEADS_FOR_COMPARISON = 20;
/** Below this spend, "no leads" may just mean the campaign has barely run. */
const MIN_SPEND_TO_JUDGE = 500;

function money(v: number | null): string {
  return v === null ? 'unknown' : `₹${Math.round(v).toLocaleString('en-IN')}`;
}

export function analysePerformance(
  campaigns: CampaignPerformance[],
  totals: PerformanceTotals
): Finding[] {
  const findings: Finding[] = [];
  const real = campaigns.filter((c) => !c.untraceable);

  if (real.length === 0 && totals.leads === 0) {
    return [{
      fingerprint: 'no-data',
      kind: 'INSUFFICIENT_DATA',
      title: 'Nothing to analyse yet',
      evidence: [{ label: 'Campaigns with figures', value: '0' }, { label: 'Leads', value: '0' }],
      confidence: 'HIGH',
      campaignKey: null,
      requiredAction: 'Create and launch a campaign, then let the nightly refresh collect a few days of figures.',
      expectedImpact: 'None yet — this is the starting point.',
      risk: 'None.',
    }];
  }

  if (totals.spend === null) {
    findings.push({
      fingerprint: 'no-spend-data',
      kind: 'NO_SPEND_DATA',
      title: 'No advertising spend has been collected',
      evidence: [{ label: 'Leads recorded', value: String(totals.leads) }, { label: 'Spend', value: 'not collected' }],
      confidence: 'HIGH',
      campaignKey: null,
      requiredAction: 'Set up the nightly refresh so spend can be matched to results.',
      expectedImpact: 'Without spend, cost per booking cannot be calculated for any campaign.',
      risk: 'Decisions made now would be based on leads alone.',
    });
  }

  // Money going out with nothing coming back.
  for (const c of real) {
    if (c.spendWithNoLeads && (c.spend ?? 0) >= MIN_SPEND_TO_JUDGE) {
      findings.push({
        fingerprint: `spend-no-leads:${c.key}`,
        kind: 'SPEND_NO_LEADS',
        title: `${c.name} is spending and producing nothing`,
        evidence: [
          { label: 'Spent', value: money(c.spend) },
          { label: 'Leads', value: '0' },
          { label: 'Clicks', value: String(c.clicks) },
        ],
        confidence: (c.spend ?? 0) >= MIN_SPEND_TO_JUDGE * 4 ? 'HIGH' : 'MEDIUM',
        campaignKey: c.key,
        requiredAction: c.clicks > 0
          ? 'People are clicking but not enquiring. Review the page they land on before spending more.'
          : 'Nobody is clicking. Regenerate the ad copy, or pause this campaign.',
        expectedImpact: `Stops ${money(c.spend)} of spend producing nothing.`,
        risk: 'If the campaign only started recently there may simply not be enough data yet.',
      });
    }
  }

  // Leads arriving but never becoming bookings.
  const leadsNoBookings = real.filter((c) => c.leads >= 5 && c.booked === 0);
  for (const c of leadsNoBookings) {
    findings.push({
      fingerprint: `no-bookings:${c.key}`,
      kind: 'NO_BOOKINGS_YET',
      title: `${c.name} is bringing enquiries but no bookings`,
      evidence: [
        { label: 'Leads', value: String(c.leads) },
        { label: 'Reached booked', value: '0' },
        { label: 'Spent', value: money(c.spend) },
      ],
      confidence: c.leads >= 15 ? 'HIGH' : 'MEDIUM',
      campaignKey: c.key,
      requiredAction: 'Check how quickly enquiries are being followed up, and whether the offer matches what people expected.',
      expectedImpact: 'Turning even a few of these into bookings changes the campaign from a loss to a gain.',
      risk: 'Bookings may exist but not have been recorded against these leads yet.',
    });
  }

  // Ranking is only honest with enough data behind it.
  const rankable = real.filter((c) => c.costPerPayingCustomer !== null);
  if (rankable.length >= 2) {
    const sorted = [...rankable].sort(
      (a, b) => (a.costPerPayingCustomer as number) - (b.costPerPayingCustomer as number)
    );
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const enough = best.leads + worst.leads >= MIN_LEADS_FOR_COMPARISON;

    findings.push({
      fingerprint: `best-value:${best.key}`,
      kind: 'BEST_VALUE_CAMPAIGN',
      title: `${best.name} wins customers most cheaply`,
      evidence: [
        { label: 'Cost per paying customer', value: money(best.costPerPayingCustomer) },
        { label: 'Paying customers', value: String(best.paid) },
        { label: 'Spent', value: money(best.spend) },
      ],
      confidence: enough ? 'HIGH' : 'LOW',
      campaignKey: best.key,
      requiredAction: enough
        ? 'Consider putting more of your budget behind this one.'
        : 'Keep running it, but wait for more data before shifting budget.',
      expectedImpact: 'Moving budget towards the cheaper campaign lowers your average cost per customer.',
      risk: enough ? 'Past performance is not a guarantee.' : 'Too few results so far; the gap could be chance.',
    });

    if (worst.key !== best.key && (worst.costPerPayingCustomer as number) > (best.costPerPayingCustomer as number) * 1.5) {
      findings.push({
        fingerprint: `worst-value:${worst.key}`,
        kind: 'WORST_VALUE_CAMPAIGN',
        title: `${worst.name} costs much more per customer`,
        evidence: [
          { label: 'Cost per paying customer', value: money(worst.costPerPayingCustomer) },
          { label: 'Compared with', value: `${best.name} at ${money(best.costPerPayingCustomer)}` },
          { label: 'Paying customers', value: String(worst.paid) },
        ],
        confidence: enough ? 'HIGH' : 'LOW',
        campaignKey: worst.key,
        requiredAction: 'Regenerate its ad copy, or move its budget to the better performer.',
        expectedImpact: `Each customer currently costs ${money((worst.costPerPayingCustomer as number) - (best.costPerPayingCustomer as number))} more than it needs to.`,
        risk: enough ? 'The two campaigns may target different kinds of customer.' : 'Too few results to be sure.',
      });
    }
  } else if (real.length >= 2 && totals.leads > 0) {
    findings.push({
      fingerprint: 'not-enough-to-compare',
      kind: 'INSUFFICIENT_DATA',
      title: 'Not enough results to compare campaigns yet',
      evidence: [
        { label: 'Campaigns running', value: String(real.length) },
        { label: 'Paying customers recorded', value: String(totals.paying) },
      ],
      confidence: 'HIGH',
      campaignKey: null,
      requiredAction: 'Keep both running and record which enquiries turn into paying customers.',
      expectedImpact: 'Once paying customers are recorded, campaigns can be compared honestly.',
      risk: 'Acting now would be guessing.',
    });
  }

  // Untraceable leads distort every per-campaign figure.
  if (totals.untraceableLeads > 0 && totals.leads > 0) {
    const share = Math.round((totals.untraceableLeads / totals.leads) * 100);
    if (share >= 20) {
      findings.push({
        fingerprint: 'attribution-gap',
        kind: 'ATTRIBUTION_GAP',
        title: `${share}% of your enquiries cannot be traced to a campaign`,
        evidence: [
          { label: 'Untraceable leads', value: String(totals.untraceableLeads) },
          { label: 'Total leads', value: String(totals.leads) },
        ],
        confidence: 'HIGH',
        campaignKey: null,
        requiredAction: 'Have the website record the Google click id with every enquiry so results can be credited properly.',
        expectedImpact: 'Every campaign currently looks worse than it is.',
        risk: 'Budget decisions made on these figures may back the wrong campaign.',
      });
    }
  }

  return findings;
}
