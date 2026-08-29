import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { loadOpenRecommendations } from '@/lib/analysis/recommendations';
import { RecommendationCard } from './RecommendationCard';
import { AnalyseButton } from './AnalyseButton';

export const dynamic = 'force-dynamic';

export default async function RecommendationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  const recommendations = await loadOpenRecommendations(user.id);

  const { data: decided } = await supabase
    .from('recommendations')
    .select('id, title, status, decided_at')
    .eq('owner_id', user.id)
    .neq('status', 'OPEN')
    .order('decided_at', { ascending: false })
    .limit(8);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">What to do next</h1>
          <p className="mt-2 max-w-prose text-muted-foreground">
            Based only on what has actually been measured. Every suggestion shows the figures
            behind it, and nothing happens until you decide.
          </p>
        </div>
        <AnalyseButton />
      </div>

      {recommendations.length === 0 ? (
        <div className="mt-8 rounded-lg border bg-white p-10 text-center shadow-sm">
          <h2 className="text-lg font-semibold">Nothing needs your attention</h2>
          <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">
            Either everything is running well, or there is not enough data yet to say anything
            useful. Marketing OS will not invent advice to fill this space.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          {recommendations.map((rec) => <RecommendationCard key={rec.id} rec={rec} />)}
        </div>
      )}

      {decided && decided.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">Already decided</h2>
          <ul className="divide-y rounded-lg border bg-white text-sm shadow-sm">
            {decided.map((d: { id: string; title: string; status: string }) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span>{d.title}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${
                  d.status === 'APPROVED' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'
                }`}>
                  {d.status === 'APPROVED' ? 'You said yes' : 'Dismissed'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
