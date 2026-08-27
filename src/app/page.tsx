import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  buildPerformance,
  rankByCostPerPayingCustomer,
  type SpendRow,
  type LeadRow,
  type CampaignPerformance,
} from '@/lib/metrics/performance';
import { formatMoney, formatCount, formatMultiple } from '@/lib/metrics/format';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  const [{ data: spend }, { data: leads }, { data: campaigns }] = await Promise.all([
    supabase
      .from('campaign_daily_metrics')
      .select('google_campaign_id, google_campaign_name, campaign_id, cost_amount, impressions, clicks, currency_code, metric_date')
      .eq('owner_id', user.id),
    supabase
      .from('leads')
      .select('id, status, revenue_amount, attributed_google_campaign_id, gclid, attribution_checked_at')
      .eq('owner_id', user.id),
    supabase.from('unified_campaigns').select('id, service').eq('owner_id', user.id),
  ]);

  const names = new Map<string, string>(
    (campaigns || []).map((c: { id: string; service: string }) => [c.id, c.service])
  );
  const { campaigns: rows, totals } = buildPerformance(
    (spend || []) as SpendRow[],
    (leads || []) as LeadRow[],
    names
  );
  const { best, worst, rankable } = rankByCostPerPayingCustomer(rows);
  const nothingYet = (spend || []).length === 0 && (leads || []).length === 0;

  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">Marketing OS Dashboard</h1>
        <Link href="/performance" className="text-sm font-medium text-blue-700 underline">
          See every campaign
        </Link>
      </div>

      {nothingYet ? (
        <div className="rounded-lg border bg-white p-10 text-center shadow-sm">
          <h2 className="text-lg font-semibold">No results yet</h2>
          <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">
            Spend and leads appear here once a campaign is running and the nightly refresh has
            pulled its first day of figures.
          </p>
          <Link href="/campaigns/new" className="mt-5 inline-block rounded bg-black px-4 py-2 text-sm text-white">
            Create a campaign
          </Link>
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Total spend" value={formatMoney(totals.spend, totals.currency)} />
            <Tile label="Leads received" value={formatCount(totals.leads)} />
            <Tile label="Paying customers" value={formatCount(totals.paying)} />
            <Tile
              label="Revenue"
              value={totals.revenue > 0 ? formatMoney(totals.revenue, totals.currency) : 'No data yet'}
              tone={totals.revenue > 0 ? 'good' : 'plain'}
            />
          </section>

          <section className="mt-3 grid gap-3 sm:grid-cols-3">
            <Tile label="Cost per lead" value={formatMoney(totals.costPerLead, totals.currency)} small />
            <Tile label="Cost per paying customer" value={formatMoney(totals.costPerPayingCustomer, totals.currency)} small />
            <Tile label="Revenue for every rupee spent" value={formatMultiple(totals.returnOnSpend)} small />
          </section>

          <section className="mt-8 grid gap-4 md:grid-cols-2">
            <Highlight
              title="Best value campaign"
              subtitle="Cheapest paying customer"
              campaign={best}
              currency={totals.currency}
              tone="good"
              rankable={rankable}
            />
            <Highlight
              title="Worst value campaign"
              subtitle="Most expensive paying customer"
              campaign={worst}
              currency={totals.currency}
              tone="bad"
              rankable={rankable}
            />
          </section>

          {totals.untraceableLeads > 0 && (
            <p className="mt-6 max-w-prose rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <strong>{formatCount(totals.untraceableLeads)} leads could not be traced to a
              campaign.</strong> They count towards your totals above, but no campaign gets credit
              for them, so per-campaign figures understate performance.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, tone = 'plain', small = false }: { label: string; value: string; tone?: 'plain' | 'good'; small?: boolean }) {
  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 font-bold tabular-nums ${small ? 'text-xl' : 'text-2xl'} ${tone === 'good' ? 'text-green-700' : ''}`}>
        {value}
      </p>
    </div>
  );
}

function Highlight({
  title, subtitle, campaign, currency, tone, rankable,
}: {
  title: string;
  subtitle: string;
  campaign: CampaignPerformance | null;
  currency: string;
  tone: 'good' | 'bad';
  rankable: number;
}) {
  const accent = tone === 'good' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50';
  const figure = tone === 'good' ? 'text-green-800' : 'text-red-800';

  if (!campaign) {
    return (
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <p className="font-semibold">{title}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {rankable === 0
            ? 'No data yet. Ranking needs at least one campaign with both spend and a paying customer.'
            : 'No data yet. Only one campaign can be ranked so far, so there is nothing to compare it against.'}
        </p>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border p-5 shadow-sm ${accent}`}>
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
      <p className="mt-3 truncate text-lg font-medium">{campaign.name}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${figure}`}>
        {formatMoney(campaign.costPerPayingCustomer, currency)}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        {formatMoney(campaign.spend, currency)} spent · {formatCount(campaign.paid)} paying{' '}
        {campaign.paid === 1 ? 'customer' : 'customers'}
      </p>
    </div>
  );
}
