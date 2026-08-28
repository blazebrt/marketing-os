import { createServiceClient } from '@/lib/supabase/service';
import { logSafeError } from '@/lib/errors';
import {
  fetchDailyCampaignMetrics,
  resolveGclidsToCampaigns,
  GoogleReportingError,
  yesterdayIso,
} from '@/lib/providers/google/reporting';

/**
 * Persists Google Ads reporting data. Read-only against Google; the only
 * writes are to our own tables.
 *
 * Everything here is safe to run twice: metrics upsert on
 * (owner_id, google_campaign_id, metric_date), and attribution only fills in
 * leads that have no answer yet.
 */

export type OwnerSyncResult = {
  ownerId: string;
  metricRows: number;
  campaignsLinked: number;
  leadsAttributed: number;
  leadsUnresolved: number;
  error?: string;
};

export type SyncSummary = {
  date: string;
  ownersProcessed: number;
  owners: OwnerSyncResult[];
};

/** "customers/123/campaigns/456" -> "456" */
export function campaignIdFromResourceName(resourceName: unknown): string | null {
  if (typeof resourceName !== 'string') return null;
  const match = resourceName.match(/campaigns\/(\d+)/);
  return match ? match[1] : null;
}

type Db = ReturnType<typeof createServiceClient>;

/**
 * channel_deployments.external_campaign_id was never populated by the
 * deployment code, but the id is recoverable from the resource name already
 * stored in external_state. Filling it in is a local write only.
 */
export async function backfillExternalCampaignIds(db: Db, ownerId: string): Promise<number> {
  const { data: deployments } = await db
    .from('channel_deployments')
    .select('id, external_state, external_campaign_id')
    .eq('owner_id', ownerId)
    .eq('provider', 'google');

  let filled = 0;
  for (const dep of deployments || []) {
    if (dep.external_campaign_id) continue;
    const state = dep.external_state as { campaignResourceName?: unknown } | null;
    const id = campaignIdFromResourceName(state?.campaignResourceName);
    if (!id) continue;
    const { error } = await db
      .from('channel_deployments')
      .update({ external_campaign_id: id })
      .eq('id', dep.id)
      .eq('owner_id', ownerId);
    if (!error) filled += 1;
  }
  return filled;
}

/** Google campaign id -> our unified_campaigns id, for this owner. */
async function buildCampaignMap(db: Db, ownerId: string): Promise<Map<string, string>> {
  const { data } = await db
    .from('channel_deployments')
    .select('campaign_id, external_campaign_id')
    .eq('owner_id', ownerId)
    .eq('provider', 'google')
    .not('external_campaign_id', 'is', null);

  const map = new Map<string, string>();
  for (const row of data || []) {
    if (row.external_campaign_id && row.campaign_id) {
      map.set(String(row.external_campaign_id), String(row.campaign_id));
    }
  }
  return map;
}

/** Pulls one day of metrics for one owner and upserts them. */
export async function refreshMetricsForOwner(
  db: Db,
  ownerId: string,
  date: string
): Promise<{ metricRows: number; campaignsLinked: number }> {
  const campaignsLinked = await backfillExternalCampaignIds(db, ownerId);
  const campaignMap = await buildCampaignMap(db, ownerId);

  const metrics = await fetchDailyCampaignMetrics(ownerId, date, date);
  if (metrics.length === 0) return { metricRows: 0, campaignsLinked };

  const rows = metrics.map((m) => ({
    owner_id: ownerId,
    campaign_id: campaignMap.get(m.googleCampaignId) ?? null,
    google_campaign_id: m.googleCampaignId,
    google_campaign_name: m.googleCampaignName,
    metric_date: m.date,
    cost_micros: m.costMicros,
    cost_amount: m.costAmount,
    currency_code: m.currencyCode,
    impressions: m.impressions,
    clicks: m.clicks,
    conversions: m.conversions,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const { error } = await db
    .from('campaign_daily_metrics')
    .upsert(rows, { onConflict: 'owner_id,google_campaign_id,metric_date' });

  if (error) {
    logSafeError('refreshMetricsForOwner', error);
    throw new Error('METRICS_WRITE_FAILED');
  }

  return { metricRows: rows.length, campaignsLinked };
}

const ATTRIBUTION_LOOKBACK_DAYS = 60;

/**
 * Fills in which campaign each lead came from, using Google's click report.
 * Only touches leads that carry a click id and have no answer yet. Leads whose
 * click id Google cannot place are stamped as checked so they are not retried
 * every night, and stay visible as untraceable on the performance page.
 */
export async function resolveLeadAttributionForOwner(
  db: Db,
  ownerId: string
): Promise<{ attributed: number; unresolved: number }> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - ATTRIBUTION_LOOKBACK_DAYS);

  const { data: leads } = await db
    .from('leads')
    .select('id, gclid, created_at')
    .eq('owner_id', ownerId)
    .not('gclid', 'is', null)
    .is('attributed_google_campaign_id', null)
    .is('attribution_checked_at', null)
    .gte('created_at', since.toISOString())
    .limit(500);

  if (!leads || leads.length === 0) return { attributed: 0, unresolved: 0 };

  const byDate = new Map<string, string[]>();
  for (const lead of leads) {
    if (!lead.gclid) continue;
    const day = String(lead.created_at).slice(0, 10);
    const bucket = byDate.get(day) || [];
    bucket.push(String(lead.gclid));
    byDate.set(day, bucket);
  }

  const resolved = await resolveGclidsToCampaigns(ownerId, byDate);

  let attributed = 0;
  let unresolved = 0;
  const checkedAt = new Date().toISOString();

  for (const lead of leads) {
    const campaignId = lead.gclid ? resolved.get(String(lead.gclid)) : undefined;
    const patch = campaignId
      ? { attributed_google_campaign_id: campaignId, attribution_checked_at: checkedAt }
      : { attribution_checked_at: checkedAt };

    const { error } = await db.from('leads').update(patch).eq('id', lead.id).eq('owner_id', ownerId);
    if (error) continue;
    if (campaignId) attributed += 1;
    else unresolved += 1;
  }

  return { attributed, unresolved };
}

/** Owners with a connected Google integration. */
export async function listConnectedOwners(db: Db): Promise<string[]> {
  const { data } = await db
    .from('integrations')
    .select('owner_id')
    .eq('provider', 'google')
    .eq('status', 'connected');

  return Array.from(new Set((data || []).map((r: { owner_id: string }) => String(r.owner_id))));
}

/**
 * The whole nightly job: yesterday's metrics for every connected account,
 * plus a pass at attributing any new leads. One account failing never stops
 * the others -- its error is recorded and the run continues.
 */
export async function refreshAllConnectedAccounts(date?: string): Promise<SyncSummary> {
  const db = createServiceClient();
  const targetDate = date || yesterdayIso();
  const owners = await listConnectedOwners(db);
  const results: OwnerSyncResult[] = [];

  for (const ownerId of owners) {
    const result: OwnerSyncResult = {
      ownerId,
      metricRows: 0,
      campaignsLinked: 0,
      leadsAttributed: 0,
      leadsUnresolved: 0,
    };
    try {
      const metrics = await refreshMetricsForOwner(db, ownerId, targetDate);
      result.metricRows = metrics.metricRows;
      result.campaignsLinked = metrics.campaignsLinked;
    } catch (err) {
      logSafeError('refreshAllConnectedAccounts.metrics', err);
      result.error = err instanceof GoogleReportingError ? err.code : 'METRICS_FAILED';
    }

    try {
      const attribution = await resolveLeadAttributionForOwner(db, ownerId);
      result.leadsAttributed = attribution.attributed;
      result.leadsUnresolved = attribution.unresolved;
    } catch (err) {
      logSafeError('refreshAllConnectedAccounts.attribution', err);
      result.error = result.error || 'ATTRIBUTION_FAILED';
    }

    results.push(result);
  }

  return { date: targetDate, ownersProcessed: owners.length, owners: results };
}
