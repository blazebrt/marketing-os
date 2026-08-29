import { createClient } from '@/lib/supabase/server';
import { buildPerformance, type SpendRow, type LeadRow } from '@/lib/metrics/performance';
import { analysePerformance, type Finding } from './findings';
import { logSafeError } from '@/lib/errors';

/**
 * Turns measured performance into recommendations the owner can act on.
 *
 * The findings are computed deterministically; this only persists them. Each
 * one carries a fingerprint so re-running refreshes an existing recommendation
 * instead of stacking duplicates, and a recommendation the owner has already
 * decided on is never silently reopened.
 */

export type StoredRecommendation = {
  id: string;
  kind: string;
  title: string;
  what: string;
  why: string;
  evidence: { label: string; value: string }[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  expected_impact: string | null;
  risk: string | null;
  required_action: string;
  status: 'OPEN' | 'APPROVED' | 'DISMISSED' | 'DONE';
  campaign_id: string | null;
  created_at: string;
};

function findingToRow(ownerId: string, f: Finding, campaignId: string | null) {
  return {
    owner_id: ownerId,
    campaign_id: campaignId,
    kind: f.kind,
    title: f.title,
    what: f.requiredAction,
    why: f.evidence.map((e) => `${e.label}: ${e.value}`).join(' · '),
    evidence: f.evidence,
    confidence: f.confidence,
    expected_impact: f.expectedImpact,
    risk: f.risk,
    required_action: f.requiredAction,
    fingerprint: f.fingerprint,
    evidence_window: { generated_at: new Date().toISOString() },
  };
}

export async function refreshRecommendations(ownerId: string): Promise<{
  generated: number;
  findings: Finding[];
}> {
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
  // Google campaign id -> our campaign id, so a recommendation can link through.
  const { data: deployments } = await supabase
    .from('channel_deployments')
    .select('campaign_id, external_campaign_id')
    .eq('owner_id', ownerId)
    .eq('provider', 'google');
  const byGoogleId = new Map<string, string>(
    (deployments || [])
      .filter((d: { external_campaign_id: string | null }) => !!d.external_campaign_id)
      .map((d: { campaign_id: string; external_campaign_id: string }) => [d.external_campaign_id, d.campaign_id])
  );

  const { campaigns: rows, totals } = buildPerformance(
    (spend || []) as SpendRow[],
    (leads || []) as LeadRow[],
    names
  );

  const findings = analysePerformance(rows, totals);
  if (findings.length === 0) return { generated: 0, findings: [] };

  const payload = findings.map((f) =>
    findingToRow(ownerId, f, f.campaignKey ? byGoogleId.get(f.campaignKey) ?? null : null)
  );

  const { error } = await supabase
    .from('recommendations')
    .upsert(payload, { onConflict: 'owner_id,fingerprint' });

  if (error) {
    logSafeError('refreshRecommendations', error);
    return { generated: 0, findings };
  }

  return { generated: findings.length, findings };
}

export async function loadOpenRecommendations(ownerId: string): Promise<StoredRecommendation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('recommendations')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('status', 'OPEN')
    .order('confidence', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(10);
  return (data || []) as StoredRecommendation[];
}
