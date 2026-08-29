import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { loadSalonContext } from '@/lib/salon/context';
import { salonContextGaps } from '@/lib/salon/types';
import { SalonEditor } from './SalonEditor';

export const dynamic = 'force-dynamic';

export default async function SalonPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  const context = await loadSalonContext(user.id);
  const gaps = salonContextGaps(context);

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-bold">Your salon</h1>
      <p className="mt-2 max-w-prose text-muted-foreground">
        Fill this in once. Everything Marketing OS plans and writes comes from here, so the more
        accurate it is, the better your campaigns will be.
      </p>

      {gaps.length > 0 && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="font-semibold text-amber-900">Still needed before Marketing OS can plan</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {gaps.map((g) => <li key={g}>{g}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-8">
        <SalonEditor
          initialProfile={context.profile}
          initialServices={context.services}
          initialOffers={context.offers}
        />
      </div>
    </div>
  );
}
