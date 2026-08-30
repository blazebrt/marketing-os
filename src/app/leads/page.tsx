import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { updateLead } from './actions';

export default async function LeadsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  const { data: leads } = await supabase.from('leads').select('*').order('created_at', { ascending: false });

  const statuses = ['NEW', 'CONTACTED', 'BOOKED', 'VISITED', 'PAID', 'LOST', 'UNKNOWN'];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Lead Pipeline</h1>
      
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {leads?.map((lead: any) => (
            <li key={lead.id} className="p-4 flex flex-col md:flex-row items-center justify-between">
              <div className="flex-1">
                <h3 className="text-lg font-medium">{lead.name || 'Unknown Name'}</h3>
                <p className="text-sm text-gray-500">{lead.phone} • {lead.email}</p>
                <div className="mt-1 text-xs text-gray-400">
                  <span className="font-semibold text-gray-600">Source:</span> {lead.source_channel || 'Direct'} 
                  {lead.campaign_name && ` • Campaign: ${lead.campaign_name}`}
                </div>
              </div>
              <div className="flex-1 flex justify-end">
                <form action={async (formData) => {
                  'use server';
                  const s = formData.get('status') as string;
                  const rawRevenue = formData.get('revenue');
                  const r = typeof rawRevenue === 'string' && rawRevenue.trim() !== '' ? Number(rawRevenue) : 0;
                  await updateLead(lead.id, s, r);
                }} className="flex items-center gap-4">
                  
                  <div className="flex flex-col">
                    <label className="text-xs text-gray-500">Status</label>
                    <select name="status" defaultValue={lead.status} className="border p-1 rounded">
                      {statuses.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  
                  <div className="flex flex-col">
                    <label className="text-xs text-gray-500">Revenue</label>
                    <input type="number" name="revenue" defaultValue={lead.revenue_amount} className="border p-1 rounded w-24" />
                  </div>
                  
                  <button type="submit" className="mt-4 px-3 py-1 bg-black text-white text-sm rounded">Save</button>
                </form>
              </div>
            </li>
          ))}
          {!leads?.length && <div className="p-8 text-center text-gray-500">No leads found.</div>}
        </ul>
      </div>
    </div>
  );
}
