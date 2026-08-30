import { GoogleAdsApi } from 'google-ads-api';
import { createServiceClient } from '@/lib/supabase/service';
import { decryptNamedSecret } from '@/lib/crypto';
import { logSafeError } from '@/lib/errors';
import { gaqlIntLiteral, gaqlStringLiteral } from './gaql';

/**
 * Read-only Google Ads reporting.
 *
 * Every query here is a GAQL SELECT. This module never calls mutateResources
 * and never touches the mutation gate or the test-account kill switches -- it
 * cannot create, change or spend anything. Reading a report costs nothing, so
 * it deliberately does not require GOOGLE_ADS_ALLOW_MUTATIONS to be set.
 *
 * Credentials follow the same path as the rest of the app: service client ->
 * integration_credentials -> decrypt -> in-memory only. Decrypted values never
 * reach logs, audit rows, or anything sent to the browser.
 */

export class GoogleReportingError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'GoogleReportingError';
  }
}

export const REPORTING_ERRORS = {
  NOT_CONNECTED: 'GOOGLE_NOT_CONNECTED',
  CONFIG_MISSING: 'GOOGLE_REPORTING_CONFIG_MISSING',
  UNAVAILABLE: 'GOOGLE_REPORTING_UNAVAILABLE',
} as const;

export type DailyCampaignMetric = {
  googleCampaignId: string;
  googleCampaignName: string;
  date: string;
  costMicros: number;
  costAmount: number;
  currencyCode: string;
  impressions: number;
  clicks: number;
  conversions: number;
};

const MICROS_PER_UNIT = 1_000_000;

/** Google reports money in millionths of a currency unit. */
export function microsToAmount(micros: number): number {
  return Math.round((micros / MICROS_PER_UNIT) * 100) / 100;
}

/** The API returns numbers as numbers, numeric strings, or Long-like objects. */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (value && typeof value === 'object' && 'toString' in value) {
    const n = Number(String(value));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** YYYY-MM-DD in UTC. Google expects plain dates, never timestamps. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function yesterdayIso(now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() - 1);
  return isoDate(d);
}

/** GAQL string literals are single-quoted; only ever pass validated dates. */
function assertPlainDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new GoogleReportingError(REPORTING_ERRORS.CONFIG_MISSING);
  }
  return value;
}

export let __MockReportingApi: unknown = null;
export function __setMockReportingApi(mock: unknown) {
  __MockReportingApi = mock;
}

type ReportingCustomer = { query: (gaql: string) => Promise<Record<string, unknown>[]> };

/**
 * Builds a read-only Google Ads client for one owner.
 *
 * The customer id is taken from the stored integration first, then explicit
 * reporting configuration, then the test account -- so a real connected
 * account is always preferred over the sandbox one.
 */
export async function createReportingCustomer(
  ownerId: string,
  serviceClientOverride?: unknown
): Promise<{ customer: ReportingCustomer; customerId: string }> {
  let serviceClient: {
    from: (t: string) => {
      select: (c: string) => {
        eq: (k: string, v: string) => {
          eq: (k: string, v: string) => { single: () => Promise<{ data: Record<string, string> | null }> };
        };
      };
    };
  };
  try {
    serviceClient = (serviceClientOverride as never) || (createServiceClient() as never);
  } catch {
    throw new GoogleReportingError(REPORTING_ERRORS.UNAVAILABLE);
  }

  const { data: credRow } = await serviceClient
    .from('integration_credentials')
    .select('encrypted_credentials')
    .eq('owner_id', ownerId)
    .eq('provider', 'google')
    .single();

  if (!credRow?.encrypted_credentials) {
    throw new GoogleReportingError(REPORTING_ERRORS.NOT_CONNECTED);
  }

  let refreshToken: string;
  try {
    refreshToken = decryptNamedSecret(credRow.encrypted_credentials, 'refresh_token');
  } catch {
    throw new GoogleReportingError(REPORTING_ERRORS.NOT_CONNECTED);
  }

  const { data: integrationRow } = await serviceClient
    .from('integrations')
    .select('external_id')
    .eq('owner_id', ownerId)
    .eq('provider', 'google')
    .single();

  let customerId: string;
  let loginCustomerId = '';
  try {
    customerId = gaqlIntLiteral(
      integrationRow?.external_id ||
      process.env.GOOGLE_ADS_CUSTOMER_ID ||
      process.env.GOOGLE_ADS_TEST_CUSTOMER_ID ||
      ''
    );
    const loginRaw =
      process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ||
      process.env.GOOGLE_ADS_TEST_MANAGER_ID ||
      '';
    if (loginRaw) loginCustomerId = gaqlIntLiteral(loginRaw);
  } catch {
    throw new GoogleReportingError(REPORTING_ERRORS.CONFIG_MISSING);
  }

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!developerToken || !clientId || !clientSecret || !customerId) {
    throw new GoogleReportingError(REPORTING_ERRORS.CONFIG_MISSING);
  }

  const ApiClass = (__MockReportingApi as typeof GoogleAdsApi) || GoogleAdsApi;
  const api = new ApiClass({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
  });

  const customer = api.Customer({
    customer_id: customerId,
    refresh_token: refreshToken,
    ...(loginCustomerId ? { login_customer_id: loginCustomerId } : {}),
  }) as unknown as ReportingCustomer;

  return { customer, customerId };
}

async function readCurrencyCode(customer: ReportingCustomer): Promise<string> {
  try {
    const rows = await customer.query('SELECT customer.currency_code FROM customer LIMIT 1');
    const row = rows?.[0] as { customer?: { currency_code?: string } } | undefined;
    return row?.customer?.currency_code || 'INR';
  } catch {
    // Currency is presentation detail; a failure here must not lose the metrics.
    return 'INR';
  }
}

/**
 * Daily cost, impressions, clicks and conversions per campaign, for a date
 * range inclusive of both ends.
 */
export async function fetchDailyCampaignMetrics(
  ownerId: string,
  fromDate: string,
  toDate: string,
  serviceClientOverride?: unknown
): Promise<DailyCampaignMetric[]> {
  const from = assertPlainDate(fromDate);
  const to = assertPlainDate(toDate);
  const { customer } = await createReportingCustomer(ownerId, serviceClientOverride);
  const currencyCode = await readCurrencyCode(customer);

  const gaql = `
    SELECT
      campaign.id,
      campaign.name,
      segments.date,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN ${gaqlStringLiteral(from)} AND ${gaqlStringLiteral(to)}
  `;

  let rows: Record<string, unknown>[];
  try {
    rows = await customer.query(gaql);
  } catch (err) {
    logSafeError('fetchDailyCampaignMetrics', err);
    throw new GoogleReportingError(REPORTING_ERRORS.UNAVAILABLE);
  }

  return (rows || []).map((raw) => {
    const r = raw as {
      campaign?: { id?: unknown; name?: unknown };
      segments?: { date?: unknown };
      metrics?: { cost_micros?: unknown; impressions?: unknown; clicks?: unknown; conversions?: unknown };
    };
    const costMicros = toNumber(r.metrics?.cost_micros);
    return {
      googleCampaignId: String(r.campaign?.id ?? ''),
      googleCampaignName: String(r.campaign?.name ?? ''),
      date: String(r.segments?.date ?? ''),
      costMicros,
      costAmount: microsToAmount(costMicros),
      currencyCode,
      impressions: toNumber(r.metrics?.impressions),
      clicks: toNumber(r.metrics?.clicks),
      conversions: toNumber(r.metrics?.conversions),
    };
  }).filter((m) => m.googleCampaignId && m.date);
}

/**
 * Resolves Google click ids to the campaign that produced them.
 *
 * This is the only reliable link between a lead and a campaign in this app:
 * the ads carry no campaign tag, so the click id is all we have. Google's
 * click report is queried one day at a time (the API requires a single-day
 * filter) and only covers roughly the last 90 days.
 */
export async function resolveGclidsToCampaigns(
  ownerId: string,
  gclidsByDate: Map<string, string[]>,
  serviceClientOverride?: unknown
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (gclidsByDate.size === 0) return resolved;

  const { customer } = await createReportingCustomer(ownerId, serviceClientOverride);

  for (const [date, gclids] of gclidsByDate) {
    if (gclids.length === 0) continue;
    const day = assertPlainDate(date);
    const wanted = new Set(gclids);

    const gaql = `
      SELECT click_view.gclid, campaign.id, segments.date
      FROM click_view
      WHERE segments.date = '${day}'
    `;

    try {
      const rows = await customer.query(gaql);
      for (const raw of rows || []) {
        const r = raw as { click_view?: { gclid?: unknown }; campaign?: { id?: unknown } };
        const gclid = String(r.click_view?.gclid ?? '');
        const campaignId = String(r.campaign?.id ?? '');
        if (gclid && campaignId && wanted.has(gclid)) {
          resolved.set(gclid, campaignId);
        }
      }
    } catch (err) {
      // One bad day (often "outside the click report window") must not abort
      // the rest. Those leads simply stay untraceable.
      logSafeError('resolveGclidsToCampaigns', err);
    }
  }

  return resolved;
}
