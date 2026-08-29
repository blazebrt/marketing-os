'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { ownerMessage } from '@/lib/errorMessages';
import { createGoalAndPlan } from './actions';

const GOALS = [
  { type: 'MORE_BOOKINGS', label: 'More bookings', hint: 'Fill more appointment slots' },
  { type: 'MORE_NEW_CUSTOMERS', label: 'More new customers', hint: 'Reach people who have never visited' },
  { type: 'PROMOTE_SERVICE', label: 'Promote a service', hint: 'Push one treatment in particular' },
  { type: 'PROMOTE_OFFER', label: 'Promote an offer', hint: 'Get a deal in front of people' },
  { type: 'INCREASE_REVENUE', label: 'Increase revenue', hint: 'Focus on higher-value work' },
  { type: 'FILL_SLOW_DAYS', label: 'Fill my quiet days', hint: 'Move demand to your empty days' },
  { type: 'INCREASE_REPEAT_VISITS', label: 'More repeat visits', hint: 'Bring past customers back' },
] as const;

export function GoalForm({ ready }: { ready: boolean }) {
  const router = useRouter();
  const [goalType, setGoalType] = useState<string>('MORE_BOOKINGS');
  const [description, setDescription] = useState('');
  const [target, setTarget] = useState('');
  const [budget, setBudget] = useState('');
  const [timeframe, setTimeframe] = useState('30');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createGoalAndPlan({
        goal_type: goalType,
        description: description || null,
        target_value: target ? Number(target) : null,
        timeframe_days: Number(timeframe),
        budget_amount: budget ? Number(budget) : null,
      });
      if (!result.ok) {
        setError(
          result.code === 'SALON_INCOMPLETE'
            ? 'Marketing OS needs your salon details first — add your name, area and at least one service on the Salon page.'
            : ownerMessage(result.code)
        );
        return;
      }
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="rounded-lg border bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">What do you want to achieve?</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Tell Marketing OS the business result you want. It works out what to promote, to whom, and
        how — then shows you the plan before anything happens.
      </p>

      <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {GOALS.map((g) => (
          <button
            key={g.type}
            type="button"
            onClick={() => setGoalType(g.type)}
            className={`rounded-lg border p-3 text-left transition-colors ${
              goalType === g.type ? 'border-slate-800 bg-slate-50 ring-1 ring-slate-800' : 'border-border hover:bg-muted'
            }`}
          >
            <span className="block text-sm font-medium">{g.label}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{g.hint}</span>
          </button>
        ))}
      </div>

      <div className="mt-5">
        <label className="block">
          <span className="text-sm font-medium">Anything else you want it to know?</span>
          <textarea
            className="mt-1.5 min-h-20 w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Tuesdays and Wednesdays are dead, and I would like more bridal work before the wedding season."
          />
        </label>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-sm font-medium">Target</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">Optional, e.g. 30 customers</span>
          <input type="number" className="mt-1.5 w-full rounded-md border border-border px-3 py-2 text-sm"
            value={target} onChange={(e) => setTarget(e.target.value)} placeholder="30" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Daily budget ₹</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">Never exceeded</span>
          <input type="number" className="mt-1.5 w-full rounded-md border border-border px-3 py-2 text-sm"
            value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="1500" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Over how many days?</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">Default 30</span>
          <input type="number" className="mt-1.5 w-full rounded-md border border-border px-3 py-2 text-sm"
            value={timeframe} onChange={(e) => setTimeframe(e.target.value)} />
        </label>
      </div>

      <button
        type="submit"
        disabled={pending || !ready}
        className="mt-6 flex items-center gap-2 rounded-lg bg-black px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
      >
        <Sparkles className={`h-4 w-4 ${pending ? 'animate-pulse' : ''}`} />
        {pending ? 'Working out a plan…' : 'Ask Marketing OS for a plan'}
      </button>

      {!ready && (
        <p className="mt-3 text-sm text-amber-800">
          Add your salon name, area and at least one service first.
        </p>
      )}
      {error && <p className="mt-3 max-w-prose text-sm text-red-700">{error}</p>}
    </form>
  );
}
