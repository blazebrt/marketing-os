import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  buildPerformance,
  type SpendRow,
  type LeadRow,
  type CampaignPerformance,
} from '@/lib/metrics/performance';
import { formatMoney, formatCount, formatMultiple, metricsSinceIso } from '@/lib/metrics/format';

export const dynamic = 'force-dynamic';

export default async function PerformancePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  const [{ data: spend }, { data: leads }, { data: campaigns }] = await Promise.all([
    supabase
      .from('campaign_daily_metrics')
      .select('google_campaign_id, google_campaign_name, campaign_id, cost_amount, impressions, clicks, currency_code, metric_date')
      .eq('owner_id', user.id)
      .gte('metric_date', metricsSinceIso())
      .order('metric_date', { ascending: false }),
    supabase
      .from('leads')
      .select('id, status, revenue_amount, attributed_google_campaign_id, gclid, attribution_checked_at')
      .eq('owner_id', user.id),
    supabase
      .from('unified_campaigns')
      .select('id, service')
      .eq('owner_id', user.id),
  ]);

  const names = new Map<string, string>(
    (campaigns || []).map((c: { id: string; service: string }) => [c.id, c.service])
  );
  const spendRows = (spend || []) as SpendRow[];
  const { campaigns: rows, totals } = buildPerformance(spendRows, (leads || []) as LeadRow[], names);

  const dates = spendRows.map((r) => r.metric_date).filter(Boolean).sort();
  const coverage = dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
  const hasNothing = spendRows.length === 0 && (leads || []).length === 0;

  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">Campaign performance</h1>
        {coverage && (
          <p className="text-sm text-muted-foreground">
            Google Ads figures from {coverage.from} to {coverage.to}
          </p>
        )}
      </div>
      <p className="mb-6 max-w-prose text-sm text-muted-foreground">
        What each campaign cost, and what came back from it. A figure only appears when the
        numbers behind it are known — anything else says so rather than showing a misleading zero.
      </p>

      {hasNothing ? (
        <EmptyState />
      ) : (
        <>
          <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Total spend" value={formatMoney(totals.spend, totals.currency)} />
            <Tile label="Leads received" value={formatCount(totals.leads)} />
            <Tile label="Paying customers" value={formatCount(totals.paying)} />
            <Tile
              label="Revenue"
              value={totals.revenue > 0 ? formatMoney(totals.revenue, totals.currency) : 'No data yet'}
              tone={totals.revenue > 0 ? 'good' : 'plain'}
            />
          </section>

          {spendRows.length === 0 && (
            <Banner tone="warn" title="No Google Ads figures yet">
              Leads are shown below, but no spend has been pulled from Google. The nightly refresh
              has not run, or it has nothing to report yet. Setup steps are in{' '}
              <code className="rounded bg-slate-200 px-1">docs/scheduled-refresh.md</code>.
            </Banner>
          )}

          {totals.untraceableLeads > 0 && (
            <Banner tone="warn" title={`${formatCount(totals.untraceableLeads)} leads could not be traced to a campaign`}>
              These leads are counted in your totals but cannot be credited to any campaign, so
              cost per lead is understated for every campaign below.
              {totals.leadsAwaitingAttribution > 0 && (
                <> {formatCount(totals.leadsAwaitingAttribution)} of them are still waiting on
                tonight&apos;s refresh and may yet be matched.</>
              )}
            </Banner>
          )}

          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left">
                  <Th className="w-[26%]">Campaign</Th>
                  <Th align="right">Spent</Th>
                  <Th align="right">Leads</Th>
                  <Th align="right">Booked</Th>
                  <Th align="right">Visited</Th>
                  <Th align="right">Paid</Th>
                  <Th align="right">Revenue</Th>
                  <Th align="right">Cost / lead</Th>
                  <Th align="right">Cost / customer</Th>
                  <Th align="right">Return</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Row key={row.key} row={row} currency={totals.currency} />
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 max-w-prose text-xs text-muted-foreground">
            Booked, Visited and Paid count leads that reached at least that stage. The app records
            only a lead&apos;s current status, so a lead marked Lost is not counted as having
            reached any earlier stage.
          </p>
        </>
      )}
    </div>
  );
}

function Row({ row, currency }: { row: CampaignPerformance; currency: string }) {
  const muted = 'text-slate-400';
  return (
    <tr className={`border-b last:border-0 ${row.untraceable ? 'bg-amber-50/60' : ''}`}>
      <Td>
        <div className="font-medium">{row.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {row.untraceable && (
            <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-900">
              no campaign
            </span>
          )}
          {!row.untraceable && !row.linkedToApp && (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-700">
              not created here
            </span>
          )}
          {row.spendWithNoLeads && (
            <span className="rounded-full bg-red-200 px-2 py-0.5 text-[11px] font-medium text-red-900">
              spend, no leads
            </span>
          )}
        </div>
      </Td>
      <Td align="right" className={row.spend === null ? muted : ''}>
        {formatMoney(row.spend, currency)}
      </Td>
      <Td align="right" className={row.leads === 0 ? muted : 'font-medium'}>
        {formatCount(row.leads)}
      </Td>
      <Td align="right" className={row.booked === 0 ? muted : ''}>{formatCount(row.booked)}</Td>
      <Td align="right" className={row.visited === 0 ? muted : ''}>{formatCount(row.visited)}</Td>
      <Td align="right" className={row.paid === 0 ? muted : 'font-medium'}>{formatCount(row.paid)}</Td>
      <Td align="right" className={row.revenue === 0 ? muted : 'text-green-700'}>
        {row.revenue > 0 ? formatMoney(row.revenue, currency) : 'No data yet'}
      </Td>
      <Td align="right" className={row.costPerLead === null ? muted : ''}>
        {formatMoney(row.costPerLead, currency)}
      </Td>
      <Td align="right" className={row.costPerPayingCustomer === null ? muted : ''}>
        {formatMoney(row.costPerPayingCustomer, currency)}
      </Td>
      <Td align="right" className={row.returnOnSpend === null ? muted : 'font-medium'}>
        {formatMultiple(row.returnOnSpend)}
      </Td>
    </tr>
  );
}

function Th({ children, align = 'left', className = '' }: { children: React.ReactNode; align?: 'left' | 'right'; className?: string }) {
  return (
    <th className={`px-4 py-3 font-medium text-slate-600 ${align === 'right' ? 'text-right whitespace-nowrap' : ''} ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, align = 'left', className = '' }: { children: React.ReactNode; align?: 'left' | 'right'; className?: string }) {
  return (
    <td className={`px-4 py-3 ${align === 'right' ? 'text-right tabular-nums whitespace-nowrap' : ''} ${className}`}>
      {children}
    </td>
  );
}

function Tile({ label, value, tone = 'plain' }: { label: string; value: string; tone?: 'plain' | 'good' }) {
  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone === 'good' ? 'text-green-700' : ''}`}>
        {value}
      </p>
    </div>
  );
}

function Banner({ tone, title, children }: { tone: 'warn'; title: string; children: React.ReactNode }) {
  return (
    <div className={`mb-6 rounded-lg border p-4 ${tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900' : ''}`}>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 max-w-prose text-sm">{children}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border bg-white p-10 text-center shadow-sm">
      <h2 className="text-lg font-semibold">Nothing to measure yet</h2>
      <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">
        Once a campaign is live and the nightly refresh has run, spend and leads appear here side
        by side. Setup steps are in <code className="rounded bg-slate-200 px-1">docs/scheduled-refresh.md</code>.
      </p>
      <Link href="/campaigns" className="mt-5 inline-block rounded bg-black px-4 py-2 text-sm text-white">
        Go to campaigns
      </Link>
    </div>
  );
}
