import { createClient } from '@/lib/supabase/server';
import { buildPerformance, type SpendRow, type LeadRow } from '@/lib/metrics/performance';
import type { PerformanceHistory } from './generate';

/**
 * Real, measured campaign history for the strategist.
 *
 * Built from the same figures the Performance page shows, so the AI can never
 * cite a number the owner cannot also see. When nothing has run yet this
 * returns empty, and the prompt tells the model it has no performance facts.
 */
export async function loadPerformanceHistory(ownerId: string): Promise<PerformanceHistory> {
  const supabase = await createClient();

  const [{ data: spend }, { data: leads }, { data: campaigns }] = await Promise.all([
    supabase
      .from('campaign_daily_metrics')
      .select('google_campaign_id, google_campaign_name, campaign_id, cost_amount, impressions, clicks, currency_code, metric_date')
      .eq('owner_id', ownerId),
    supabase
      .from('leads')
      .select('id, status, revenue_amount, attributed_google_campaign_id, gclid, attribution_checked_at')
      .eq('owner_id', ownerId),
    supabase.from('unified_campaigns').select('id, service').eq('owner_id', ownerId),
  ]);

  const names = new Map<string, string>(
    (campaigns || []).map((c: { id: string; service: string }) => [c.id, c.service])
  );

  const { campaigns: rows, totals } = buildPerformance(
    (spend || []) as SpendRow[],
    (leads || []) as LeadRow[],
    names
  );

  return {
    campaigns: rows
      .filter((r) => !r.untraceable)
      .map((r) => ({
        service: r.name,
        spend: r.spend,
        leads: r.leads,
        bookings: r.booked,
        paying: r.paid,
        revenue: r.revenue,
      })),
    totalSpend: totals.spend,
    totalLeads: totals.leads,
    totalBookings: rows.reduce((n, r) => n + r.booked, 0),
  };
}
