import { GoogleCreativeItem } from '@/lib/providers/google/types';

export type SectionCounts = {
  label: string;
  total: number;
  approved: number;
  rejected: number;
  pending: number;
};

export function countItems(label: string, items: GoogleCreativeItem[]): SectionCounts {
  const approved = items.filter((i) => i.owner_approved === true && !i.rejected).length;
  const rejected = items.filter((i) => i.rejected).length;
  return {
    label,
    total: items.length,
    approved,
    rejected,
    pending: items.length - approved - rejected,
  };
}

/** At-a-glance summary of what still needs the owner's decision. */
export function ReviewProgress({ sections }: { sections: SectionCounts[] }) {
  const total = sections.reduce((n, s) => n + s.total, 0);
  const approved = sections.reduce((n, s) => n + s.approved, 0);
  const rejected = sections.reduce((n, s) => n + s.rejected, 0);
  const pending = sections.reduce((n, s) => n + s.pending, 0);

  if (total === 0) return null;

  const decided = approved + rejected;
  const percent = Math.round((decided / total) * 100);

  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Review progress</h2>
        <p className="text-sm text-muted-foreground">
          {pending === 0
            ? 'Every item has been decided.'
            : `${pending} of ${total} still awaiting your decision`}
        </p>
      </div>

      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Items decided"
      >
        <div className="h-full bg-green-600 transition-all" style={{ width: `${percent}%` }} />
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <span className="text-green-700">{approved} approved</span>
        <span className="text-red-700">{rejected} rejected</span>
        <span className="text-amber-700 font-medium">{pending} awaiting decision</span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {sections.map((s) => (
          <div key={s.label} className="rounded-md border bg-slate-50 px-3 py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">{s.label}</span>
              <span
                className={`shrink-0 whitespace-nowrap text-xs font-semibold ${s.pending === 0 ? 'text-green-700' : 'text-amber-700'}`}
              >
                {s.pending === 0 ? 'Done' : `${s.pending} left`}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {s.approved} approved · {s.rejected} rejected · {s.total} total
            </p>
          </div>
        ))}
      </div>

      {pending === 0 && rejected > 0 && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Rejected items must be regenerated or restored before this campaign can be approved.
        </p>
      )}
    </div>
  );
}
