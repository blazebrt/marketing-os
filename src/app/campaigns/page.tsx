import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function CampaignsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  const { data: campaigns } = await supabase.from('unified_campaigns').select('*').order('created_at', { ascending: false });

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Marketing Campaigns</h1>
        <Link href="/campaigns/new" className="bg-black text-white px-4 py-2 rounded">
          New Campaign
        </Link>
      </div>
      
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {campaigns?.map((c: any) => (
            <li key={c.id} className="p-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium">{c.service}</h3>
                <p className="text-sm text-gray-500">{c.offer}</p>
                <div className="mt-1 flex space-x-2 text-xs">
                  <span className="bg-gray-100 text-gray-800 px-2 rounded">{c.status}</span>
                  <span className="text-gray-500">₹{c.max_daily_spend}/day</span>
                </div>
              </div>
              <Link href={`/campaigns/${c.id}`} className="text-blue-600 text-sm">View</Link>
            </li>
          ))}
          {!campaigns?.length && <div className="p-8 text-center text-gray-500">No campaigns found. Let's create your first one.</div>}
        </ul>
      </div>
    </div>
  );
}
