import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AssistantPanel } from './AssistantPanel';

export const dynamic = 'force-dynamic';

export default async function AssistantPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-bold">Ask Marketing OS</h1>
      <p className="mt-2 max-w-prose text-muted-foreground">
        It answers from your own figures only. If the numbers cannot answer your question, it will
        say so rather than guess.
      </p>
      <div className="mt-8">
        <AssistantPanel />
      </div>
    </div>
  );
}
