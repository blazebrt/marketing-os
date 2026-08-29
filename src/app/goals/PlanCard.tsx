'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, ChevronDown } from 'lucide-react';
import { ownerMessage } from '@/lib/errorMessages';
import { approvePlanAndCreateCampaign, rejectPlan } from './actions';
import type { MarketingPlan, Claim } from '@/lib/strategy/schema';

const CLAIM_STYLE: Record<Claim['kind'], { label: string; className: string }> = {
  FACT: { label: 'Measured', className: 'bg-green-100 text-green-800' },
  INFERENCE: { label: 'Reasoning', className: 'bg-blue-100 text-blue-800' },
  RECOMMENDATION: { label: 'Suggestion', className: 'bg-amber-100 text-amber-900' },
};

export function PlanCard({
  planId, plan, defaultUrl,
}: {
  planId: string;
  plan: MarketingPlan;
  defaultUrl: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState(defaultUrl || '');
  const [showDetail, setShowDetail] = useState(false);

  const needsUrl = plan.destination.type === 'WEBSITE';

  const approve = () => startTransition(async () => {
    setError(null);
    const result = await approvePlanAndCreateCampaign(planId, url);
    if (!result.ok) {
      setError(result.code === 'DESTINATION_MISSING'
        ? 'Add the web page customers should land on before approving.'
        : ownerMessage(result.code));
      return;
    }
    router.push(`/campaigns/${result.campaignId}`);
    router.refresh();
  });

  const reject = () => startTransition(async () => {
    await rejectPlan(planId);
    router.refresh();
  });

  return (
    <article className="rounded-lg border bg-white shadow-sm">
      <header className="border-b px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Marketing OS recommends
        </p>
        <h2 className="mt-1.5 text-xl font-semibold">Promote {plan.recommended_service}</h2>
        {plan.recommended_offer && (
          <p className="mt-1 text-sm text-muted-foreground">with “{plan.recommended_offer}”</p>
        )}
        <p className="mt-3 max-w-prose text-sm">{plan.why_this_service}</p>
      </header>

      <div className="grid gap-px bg-border sm:grid-cols-4">
        {[
          { label: 'Goal', value: plan.primary_kpi.replace('_', ' ').toLowerCase() },
          { label: 'Daily budget', value: `₹${plan.budget.daily_amount}` },
          { label: 'For', value: `${plan.budget.duration_days} days` },
          { label: 'Where', value: plan.geography },
        ].map((s) => (
          <div key={s.label} className="bg-white px-5 py-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="mt-0.5 text-sm font-medium capitalize">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="space-y-5 px-6 py-5">
        <div>
          <h3 className="text-sm font-semibold">Who it targets</h3>
          <p className="mt-1 text-sm text-muted-foreground">{plan.target_audience}</p>
        </div>

        <div>
          <h3 className="text-sm font-semibold">How the ads will talk</h3>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{plan.messaging_strategy}</p>
        </div>

        <div>
          <h3 className="text-sm font-semibold">Angles it will try</h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {plan.creative_angles.map((a) => (
              <li key={a.name} className="rounded-md border bg-slate-50 p-3">
                <p className="text-sm font-medium">{a.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{a.description}</p>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold">What it is basing this on</h3>
          <ul className="mt-2 space-y-2">
            {plan.claims.map((c, i) => (
              <li key={i} className="flex gap-2.5 text-sm">
                <span className={`mt-0.5 h-fit shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${CLAIM_STYLE[c.kind].className}`}>
                  {CLAIM_STYLE[c.kind].label}
                </span>
                <span>
                  {c.statement}
                  {c.evidence && <span className="block text-xs text-muted-foreground">from: {c.evidence}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <button type="button" onClick={() => setShowDetail(!showDetail)}
          className="flex items-center gap-1 text-sm text-muted-foreground underline">
          <ChevronDown className={`h-4 w-4 transition-transform ${showDetail ? 'rotate-180' : ''}`} />
          {showDetail ? 'Hide' : 'Show'} how success will be measured, assumptions and risks
        </button>

        {showDetail && (
          <div className="space-y-4 rounded-md border bg-slate-50 p-4 text-sm">
            <div>
              <p className="font-medium">How it will be measured</p>
              <p className="mt-1 text-muted-foreground">{plan.measurement_plan}</p>
            </div>
            {plan.assumptions.length > 0 && (
              <div>
                <p className="font-medium">Assuming</p>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {plan.assumptions.map((a) => <li key={a}>{a}</li>)}
                </ul>
              </div>
            )}
            {plan.risks.length > 0 && (
              <div>
                <p className="font-medium">What could go wrong</p>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {plan.risks.map((r) => <li key={r}>{r}</li>)}
                </ul>
              </div>
            )}
            <div>
              <p className="font-medium">Where customers will go</p>
              <p className="mt-1 text-muted-foreground">{plan.destination.rationale}</p>
            </div>
          </div>
        )}
      </div>

      <footer className="border-t bg-slate-50 px-6 py-5">
        {needsUrl && (
          <label className="block">
            <span className="text-sm font-medium">Page customers should land on</span>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1.5 w-full max-w-md rounded-md border border-border bg-white px-3 py-2 text-sm" />
          </label>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={approve} disabled={pending}
            className="flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
            <Check className="h-4 w-4" />
            {pending ? 'Creating…' : 'Approve and create the campaign'}
          </button>
          <button type="button" onClick={reject} disabled={pending}
            className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-white disabled:opacity-50">
            <X className="h-4 w-4" /> Not this one
          </button>
        </div>
        <p className="mt-3 max-w-prose text-xs text-muted-foreground">
          Approving creates a draft campaign. Nothing is published to Google and no money is spent
          until you review the ad copy and set it up yourself.
        </p>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </footer>
    </article>
  );
}
