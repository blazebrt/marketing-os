import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  const { data: leads } = await supabase.from('leads').select('status, revenue_amount');
  
  const total = leads?.length || 0;
  const newLeads = leads?.filter(l => l.status === 'NEW').length || 0;
  const contacted = leads?.filter(l => l.status === 'CONTACTED').length || 0;
  const bookings = leads?.filter(l => l.status === 'BOOKED').length || 0;
  const visits = leads?.filter(l => l.status === 'VISITED').length || 0;
  const revenue = leads?.reduce((sum, l) => sum + Number(l.revenue_amount), 0) || 0;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Marketing OS Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="p-6 bg-white shadow rounded-lg text-center">
          <p className="text-sm text-gray-500">Total Leads</p>
          <p className="text-3xl font-bold">{total}</p>
        </div>
        <div className="p-6 bg-white shadow rounded-lg text-center">
          <p className="text-sm text-gray-500">New</p>
          <p className="text-3xl font-bold">{newLeads}</p>
        </div>
        <div className="p-6 bg-white shadow rounded-lg text-center">
          <p className="text-sm text-gray-500">Contacted</p>
          <p className="text-3xl font-bold">{contacted}</p>
        </div>
        <div className="p-6 bg-white shadow rounded-lg text-center">
          <p className="text-sm text-gray-500">Bookings</p>
          <p className="text-3xl font-bold">{bookings}</p>
        </div>
        <div className="p-6 bg-white shadow rounded-lg text-center">
          <p className="text-sm text-gray-500">Visits</p>
          <p className="text-3xl font-bold">{visits}</p>
        </div>
        <div className="p-6 bg-white shadow rounded-lg text-center">
          <p className="text-sm text-gray-500">Pipeline Revenue</p>
          <p className="text-3xl font-bold text-green-600">₹{revenue.toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}
