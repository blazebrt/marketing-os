'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, X } from 'lucide-react';
import { ownerMessage } from '@/lib/errorMessages';
import { decideRecommendation } from './actions';
import type { StoredRecommendation } from '@/lib/analysis/recommendations';

const CONFIDENCE: Record<string, { label: string; className: string }> = {
  HIGH: { label: 'Confident', className: 'bg-green-100 text-green-800' },
  MEDIUM: { label: 'Fairly confident', className: 'bg-amber-100 text-amber-900' },
  LOW: { label: 'Early signal', className: 'bg-slate-200 text-slate-700' },
};

export function RecommendationCard({ rec }: { rec: StoredRecommendation }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const decide = (decision: 'APPROVED' | 'DISMISSED') =>
    startTransition(async () => {
      setError(null);
      const result = await decideRecommendation(rec.id, decision);
      if (!result.ok) { setError(ownerMessage(result.code)); return; }
      router.refresh();
    });

  const confidence = CONFIDENCE[rec.confidence] ?? CONFIDENCE.LOW;

  return (
    <article className="rounded-lg border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-base font-semibold">{rec.title}</h3>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${confidence.className}`}>
          {confidence.label}
        </span>
      </div>

      <p className="mt-3 text-sm"><span className="font-medium">What to do: </span>{rec.required_action}</p>

      {Array.isArray(rec.evidence) && rec.evidence.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 rounded-md bg-slate-50 px-4 py-3 text-sm">
          {rec.evidence.map((e) => (
            <div key={e.label} className="flex gap-1.5">
              <dt className="text-muted-foreground">{e.label}:</dt>
              <dd className="font-medium tabular-nums">{e.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {rec.expected_impact && (
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">If you do it: </span>{rec.expected_impact}
        </p>
      )}
      {rec.risk && (
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Worth knowing: </span>{rec.risk}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => decide('APPROVED')} disabled={pending}
          className="flex items-center gap-1.5 rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          <Check className="h-4 w-4" /> I&apos;ll do this
        </button>
        <button type="button" onClick={() => decide('DISMISSED')} disabled={pending}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
          <X className="h-4 w-4" /> Not now
        </button>
        {rec.campaign_id && (
          <Link href={`/campaigns/${rec.campaign_id}`} className="text-sm text-blue-700 underline">
            Open the campaign
          </Link>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </article>
  );
}
