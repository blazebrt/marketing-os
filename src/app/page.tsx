import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import {
  buildPerformance, rankByCostPerPayingCustomer,
  type SpendRow, type LeadRow, type CampaignPerformance,
} from '@/lib/metrics/performance';
import { formatMoney, formatCount, formatMultiple } from '@/lib/metrics/format';
import { loadSalonContext } from '@/lib/salon/context';
import { salonContextGaps } from '@/lib/salon/types';
import { analysePerformance } from '@/lib/analysis/findings';
import { RecommendationCard } from './recommendations/RecommendationCard';
import type { StoredRecommendation } from '@/lib/analysis/recommendations';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  const [{ data: spend }, { data: leads }, { data: campaigns }, salon, { data: recs }, { data: openPlans }] =
    await Promise.all([
      supabase.from('campaign_daily_metrics')
        .select('google_campaign_id, google_campaign_name, campaign_id, cost_amount, impressions, clicks, currency_code, metric_date')
        .eq('owner_id', user.id),
      supabase.from('leads')
        .select('id, status, revenue_amount, attributed_google_campaign_id, gclid, attribution_checked_at')
        .eq('owner_id', user.id),
      supabase.from('unified_campaigns').select('id, service, status').eq('owner_id', user.id),
      loadSalonContext(user.id),
      supabase.from('recommendations').select('*').eq('owner_id', user.id).eq('status', 'OPEN')
        .order('created_at', { ascending: false }).limit(3),
      supabase.from('marketing_plans').select('id').eq('owner_id', user.id).eq('status', 'DRAFT').limit(1),
    ]);

  const campaignRows = (campaigns || []) as { id: string; service: string; status: string }[];
  const names = new Map<string, string>(campaignRows.map((c) => [c.id, c.service]));
  const { campaigns: rows, totals } = buildPerformance(
    (spend || []) as SpendRow[], (leads || []) as LeadRow[], names
  );
  const { best } = rankByCostPerPayingCustomer(rows);
  const findings = analysePerformance(rows, totals);
  const headline = findings.find((f) => f.kind === 'BEST_VALUE_CAMPAIGN') ?? findings[0];

  const gaps = salonContextGaps(salon);
  const hasPlanWaiting = (openPlans || []).length > 0;
  const hasAnyCampaign = campaignRows.length > 0;
  const recommendations = (recs || []) as StoredRecommendation[];

  // The single most useful thing to do right now.
  const nextStep =
    gaps.length > 0
      ? { href: '/salon', label: 'Tell Marketing OS about your salon', why: `Still needed: ${gaps.join(', ')}.` }
      : hasPlanWaiting
        ? { href: '/goals', label: 'Review the plan waiting for you', why: 'Marketing OS has proposed a campaign.' }
        : !hasAnyCampaign
          ? { href: '/goals', label: 'Set your first goal', why: 'Tell it what business result you want.' }
          : recommendations.length > 0
            ? { href: '/recommendations', label: 'See what to do next', why: `${recommendations.length} suggestion${recommendations.length === 1 ? '' : 's'} based on your results.` }
            : { href: '/goals', label: 'Set another goal', why: 'Everything current is running.' };

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-bold">Your marketing</h1>

      {totals.leads === 0 && totals.spend === null ? (
        <FirstRun nextStep={nextStep} />
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">Everything measured so far</p>

          <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Spent" value={formatMoney(totals.spend, totals.currency)} />
            <Tile label="Enquiries" value={formatCount(totals.leads)} />
            <Tile label="Paying customers" value={formatCount(totals.paying)} />
            <Tile label="Revenue" tone={totals.revenue > 0 ? 'good' : 'plain'}
              value={totals.revenue > 0 ? formatMoney(totals.revenue, totals.currency) : 'No data yet'} />
          </section>

          <section className="mt-3 grid gap-3 sm:grid-cols-3">
            <Tile small label="Cost per enquiry" value={formatMoney(totals.costPerLead, totals.currency)} />
            <Tile small label="Cost per paying customer" value={formatMoney(totals.costPerPayingCustomer, totals.currency)} />
            <Tile small label="Revenue per rupee spent" value={formatMultiple(totals.returnOnSpend)} />
          </section>

          {headline && (
            <section className="mt-8 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" /> What Marketing OS sees
              </p>
              <h2 className="mt-2 text-lg font-semibold">{headline.title}</h2>
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                {headline.evidence.map((e) => (
                  <div key={e.label} className="flex gap-1.5">
                    <dt className="text-muted-foreground">{e.label}:</dt>
                    <dd className="font-medium tabular-nums">{e.value}</dd>
                  </div>
                ))}
              </dl>
              {best && best.name !== headline.title && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Best value so far: <span className="font-medium text-foreground">{best.name}</span> at{' '}
                  {formatMoney(best.costPerPayingCustomer, totals.currency)} per paying customer.
                </p>
              )}
            </section>
          )}
        </>
      )}

      <section className="mt-8 rounded-lg border border-slate-800 bg-slate-800 p-6 text-white shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">Do this next</p>
        <h2 className="mt-2 text-xl font-semibold">{nextStep.label}</h2>
        <p className="mt-1 text-sm text-slate-300">{nextStep.why}</p>
        <Link href={nextStep.href}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-slate-900">
          Go <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      {recommendations.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Suggestions from your results</h2>
            <Link href="/recommendations" className="text-sm text-blue-700 underline">See all</Link>
          </div>
          <div className="space-y-4">
            {recommendations.map((rec) => <RecommendationCard key={rec.id} rec={rec} />)}
          </div>
        </section>
      )}

      {totals.untraceableLeads > 0 && (
        <p className="mt-8 max-w-prose rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>{formatCount(totals.untraceableLeads)} enquiries could not be traced to a campaign.</strong>{' '}
          They count in the totals above, but no campaign gets credit, so per-campaign figures
          understate performance.
        </p>
      )}
    </div>
  );
}

function FirstRun({ nextStep }: { nextStep: { href: string; label: string; why: string } }) {
  return (
    <div className="mt-6 rounded-lg border bg-white p-8 shadow-sm">
      <h2 className="text-lg font-semibold">Nothing measured yet</h2>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Marketing OS shows what your advertising actually produced — enquiries, customers and
        revenue against what you spent. Once a campaign has run for a few days, this fills in.
      </p>
      <p className="mt-3 max-w-prose text-sm text-muted-foreground">{nextStep.why}</p>
    </div>
  );
}

function Tile({ label, value, tone = 'plain', small = false }: {
  label: string; value: string; tone?: 'plain' | 'good'; small?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 font-bold tabular-nums ${small ? 'text-xl' : 'text-2xl'} ${tone === 'good' ? 'text-green-700' : ''}`}>
        {value}
      </p>
    </div>
  );
}
