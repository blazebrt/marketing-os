/**
 * Turns raw spend rows and lead rows into the figures the performance screens
 * show. Kept separate from the pages so the dashboard summary and the detailed
 * table can never disagree about a number.
 *
 * Rule throughout: a ratio is only produced when both sides of it are known
 * and the denominator is greater than zero. Otherwise the value is null, which
 * the UI renders as "No data yet". A zero is never invented.
 */

export type LeadStatus = 'NEW' | 'CONTACTED' | 'BOOKED' | 'VISITED' | 'PAID' | 'LOST' | 'UNKNOWN';

/**
 * The pipeline in order. The app records only a lead's CURRENT status, so
 * "reached BOOKED" is read as "is at BOOKED or beyond". A lead marked LOST or
 * UNKNOWN counts as having reached nothing, because its history is not stored.
 */
const STAGE_ORDER: Record<LeadStatus, number> = {
  NEW: 0,
  CONTACTED: 1,
  BOOKED: 2,
  VISITED: 3,
  PAID: 4,
  LOST: -1,
  UNKNOWN: -1,
};

export function reachedStage(status: string, stage: LeadStatus): boolean {
  const current = STAGE_ORDER[status as LeadStatus];
  const target = STAGE_ORDER[stage];
  if (current === undefined || current < 0) return false;
  return current >= target;
}

export type SpendRow = {
  google_campaign_id: string;
  google_campaign_name: string | null;
  campaign_id: string | null;
  cost_amount: number | string;
  impressions: number | string;
  clicks: number | string;
  currency_code?: string | null;
  metric_date: string;
};

export type LeadRow = {
  id: string;
  status: string;
  revenue_amount: number | string | null;
  attributed_google_campaign_id: string | null;
  gclid: string | null;
  attribution_checked_at: string | null;
};

export type CampaignPerformance = {
  key: string;
  googleCampaignId: string | null;
  name: string;
  /** True for the bucket holding leads that could not be traced. */
  untraceable: boolean;
  /** True when this app created the campaign, rather than it just existing in Google. */
  linkedToApp: boolean;

  spend: number | null;
  impressions: number;
  clicks: number;

  leads: number;
  booked: number;
  visited: number;
  paid: number;
  revenue: number;

  costPerLead: number | null;
  costPerPayingCustomer: number | null;
  returnOnSpend: number | null;

  /** Spend went out and not one lead came back. Worth shouting about. */
  spendWithNoLeads: boolean;
};

export type PerformanceTotals = {
  spend: number | null;
  leads: number;
  paying: number;
  revenue: number;
  costPerLead: number | null;
  costPerPayingCustomer: number | null;
  returnOnSpend: number | null;
  currency: string;
  untraceableLeads: number;
  leadsAwaitingAttribution: number;
};

function num(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Divide only when the answer means something. */
export function safeRatio(numerator: number | null, denominator: number): number | null {
  if (numerator === null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100) / 100;
}

export const UNTRACEABLE_KEY = '__untraceable__';

export function buildPerformance(
  spendRows: SpendRow[],
  leadRows: LeadRow[],
  campaignNames: Map<string, string>
): { campaigns: CampaignPerformance[]; totals: PerformanceTotals } {
  type Acc = {
    googleCampaignId: string | null;
    name: string;
    linkedToApp: boolean;
    hasSpendRows: boolean;
    spend: number;
    impressions: number;
    clicks: number;
    leads: number;
    booked: number;
    visited: number;
    paid: number;
    revenue: number;
  };

  const acc = new Map<string, Acc>();
  const ensure = (key: string, seed: Partial<Acc>): Acc => {
    const existing = acc.get(key);
    if (existing) return existing;
    const fresh: Acc = {
      googleCampaignId: null,
      name: 'Unnamed campaign',
      linkedToApp: false,
      hasSpendRows: false,
      spend: 0,
      impressions: 0,
      clicks: 0,
      leads: 0,
      booked: 0,
      visited: 0,
      paid: 0,
      revenue: 0,
      ...seed,
    };
    acc.set(key, fresh);
    return fresh;
  };

  let currency = 'INR';

  for (const row of spendRows) {
    const key = row.google_campaign_id;
    const appName = row.campaign_id ? campaignNames.get(row.campaign_id) : undefined;
    const entry = ensure(key, {
      googleCampaignId: key,
      name: appName || row.google_campaign_name || `Google campaign ${key}`,
      linkedToApp: !!row.campaign_id,
    });
    if (appName) entry.name = appName;
    entry.linkedToApp = entry.linkedToApp || !!row.campaign_id;
    entry.hasSpendRows = true;
    entry.spend += num(row.cost_amount);
    entry.impressions += num(row.impressions);
    entry.clicks += num(row.clicks);
    if (row.currency_code) currency = row.currency_code;
  }

  let untraceableLeads = 0;
  let leadsAwaitingAttribution = 0;

  for (const lead of leadRows) {
    const attributed = lead.attributed_google_campaign_id;
    const key = attributed || UNTRACEABLE_KEY;

    if (!attributed) {
      untraceableLeads += 1;
      // Has a click id but has not been looked up yet -- the nightly job will try.
      if (lead.gclid && !lead.attribution_checked_at) leadsAwaitingAttribution += 1;
    }

    const entry = ensure(key, {
      googleCampaignId: attributed,
      name: attributed ? `Google campaign ${attributed}` : 'Could not be traced to a campaign',
    });

    entry.leads += 1;
    if (reachedStage(lead.status, 'BOOKED')) entry.booked += 1;
    if (reachedStage(lead.status, 'VISITED')) entry.visited += 1;
    if (reachedStage(lead.status, 'PAID')) {
      entry.paid += 1;
      entry.revenue += num(lead.revenue_amount);
    }
  }

  const campaigns: CampaignPerformance[] = Array.from(acc.entries()).map(([key, e]) => {
    const untraceable = key === UNTRACEABLE_KEY;
    // Spend is unknown for the untraceable bucket -- those leads have no campaign.
    const spend = untraceable ? null : e.hasSpendRows ? e.spend : null;

    return {
      key,
      googleCampaignId: e.googleCampaignId,
      name: e.name,
      untraceable,
      linkedToApp: e.linkedToApp,
      spend,
      impressions: e.impressions,
      clicks: e.clicks,
      leads: e.leads,
      booked: e.booked,
      visited: e.visited,
      paid: e.paid,
      revenue: e.revenue,
      costPerLead: safeRatio(spend, e.leads),
      costPerPayingCustomer: safeRatio(spend, e.paid),
      returnOnSpend: spend !== null && spend > 0 && e.revenue > 0
        ? Math.round((e.revenue / spend) * 100) / 100
        : null,
      spendWithNoLeads: spend !== null && spend > 0 && e.leads === 0,
    };
  });

  // Biggest spend first; the untraceable bucket always sits last.
  campaigns.sort((a, b) => {
    if (a.untraceable !== b.untraceable) return a.untraceable ? 1 : -1;
    return (b.spend ?? -1) - (a.spend ?? -1);
  });

  const anySpend = spendRows.length > 0;
  const totalSpend = anySpend ? campaigns.reduce((n, c) => n + (c.spend ?? 0), 0) : null;
  const totalLeads = campaigns.reduce((n, c) => n + c.leads, 0);
  const totalPaid = campaigns.reduce((n, c) => n + c.paid, 0);
  const totalRevenue = campaigns.reduce((n, c) => n + c.revenue, 0);

  return {
    campaigns,
    totals: {
      spend: totalSpend,
      leads: totalLeads,
      paying: totalPaid,
      revenue: totalRevenue,
      costPerLead: safeRatio(totalSpend, totalLeads),
      costPerPayingCustomer: safeRatio(totalSpend, totalPaid),
      returnOnSpend:
        totalSpend !== null && totalSpend > 0 && totalRevenue > 0
          ? Math.round((totalRevenue / totalSpend) * 100) / 100
          : null,
      currency,
      untraceableLeads,
      leadsAwaitingAttribution,
    },
  };
}

/**
 * Best and worst campaign by what it costs to win one paying customer.
 * Only campaigns with both spend and a paying customer can be ranked.
 */
export function rankByCostPerPayingCustomer(campaigns: CampaignPerformance[]): {
  best: CampaignPerformance | null;
  worst: CampaignPerformance | null;
  rankable: number;
} {
  const rankable = campaigns.filter((c) => !c.untraceable && c.costPerPayingCustomer !== null);
  if (rankable.length === 0) return { best: null, worst: null, rankable: 0 };

  const sorted = [...rankable].sort(
    (a, b) => (a.costPerPayingCustomer as number) - (b.costPerPayingCustomer as number)
  );
  return {
    best: sorted[0],
    worst: sorted.length > 1 ? sorted[sorted.length - 1] : null,
    rankable: rankable.length,
  };
}
