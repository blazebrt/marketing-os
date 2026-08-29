import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { loadSalonContext } from '@/lib/salon/context';
import { isSalonReadyForStrategy, salonContextGaps } from '@/lib/salon/types';
import { MarketingPlanSchema } from '@/lib/strategy/schema';
import { GoalForm } from './GoalForm';
import { PlanCard } from './PlanCard';

export const dynamic = 'force-dynamic';

export default async function GoalsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  const context = await loadSalonContext(user.id);
  const ready = isSalonReadyForStrategy(context);
  const gaps = salonContextGaps(context);

  const { data: plans } = await supabase
    .from('marketing_plans')
    .select('id, plan, status, campaign_id, created_at')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  type PlanRow = { id: string; plan: unknown; status: string; campaign_id: string | null; created_at: string };
  const planRows = (plans || []) as PlanRow[];
  const drafts = planRows.filter((p) => p.status === 'DRAFT');
  const past = planRows.filter((p) => p.status !== 'DRAFT');
  const defaultUrl = context.profile?.booking_url || context.profile?.website_url || null;

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-bold">Set a goal</h1>
      <p className="mt-2 max-w-prose text-muted-foreground">
        Say what you want for the business. Marketing OS decides what to promote and how, and shows
        you the plan for approval before anything is created.
      </p>

      {!ready && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="font-semibold text-amber-900">Add your salon details first</p>
          <p className="mt-1 text-sm text-amber-900">
            Marketing OS will not guess at your business. It still needs: {gaps.join(', ')}.
          </p>
          <Link href="/salon" className="mt-3 inline-block rounded bg-black px-4 py-2 text-sm text-white">
            Go to salon details
          </Link>
        </div>
      )}

      <div className="mt-8">
        <GoalForm ready={ready} />
      </div>

      {drafts.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold">Waiting for your decision</h2>
          <div className="space-y-6">
            {drafts.map((row) => {
              const parsed = MarketingPlanSchema.safeParse(row.plan);
              if (!parsed.success) return null;
              return <PlanCard key={row.id} planId={row.id} plan={parsed.data} defaultUrl={defaultUrl} />;
            })}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">Earlier plans</h2>
          <ul className="divide-y rounded-lg border bg-white shadow-sm">
            {past.map((row) => {
              const parsed = MarketingPlanSchema.safeParse(row.plan);
              const name = parsed.success ? parsed.data.recommended_service : 'Plan';
              return (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="font-medium">Promote {name}</span>
                  <span className="flex items-center gap-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      row.status === 'CONVERTED' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {row.status === 'CONVERTED' ? 'Campaign created' : 'Not used'}
                    </span>
                    {row.campaign_id && (
                      <Link href={`/campaigns/${row.campaign_id}`} className="text-blue-700 underline">
                        View campaign
                      </Link>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
