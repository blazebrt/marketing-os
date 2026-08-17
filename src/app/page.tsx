import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import Link from 'next/link';

export default async function DashboardPage() {
  const supabase = await createClient();

  // Fetch lead metrics
  const { data: leads } = await supabase.from('leads').select('status, revenue_amount');
  
  const totalLeads = leads?.length || 0;
  const newLeads = leads?.filter(l => l.status === 'NEW').length || 0;
  const bookedLeads = leads?.filter(l => l.status === 'BOOKED').length || 0;
  const visitedLeads = leads?.filter(l => l.status === 'VISITED').length || 0;
  const paidLeads = leads?.filter(l => l.status === 'PAID').length || 0;
  
  const totalRevenue = leads?.reduce((sum, l) => sum + (Number(l.revenue_amount) || 0), 0) || 0;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Marketing OS Dashboard</h1>
        <div className="gap-4 flex">
          <Link href="/leads" className="text-sm font-medium text-blue-600 hover:underline">View Leads Pipeline</Link>
          <Link href="/integrations" className="text-sm font-medium text-blue-600 hover:underline">Manage Integrations</Link>
        </div>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader><CardTitle>Total Leads</CardTitle></CardHeader>
          <CardContent><p className="text-4xl font-bold">{totalLeads}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>New Leads</CardTitle></CardHeader>
          <CardContent><p className="text-4xl font-bold text-blue-600">{newLeads}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Booked</CardTitle></CardHeader>
          <CardContent><p className="text-4xl font-bold text-yellow-600">{bookedLeads}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Visited</CardTitle></CardHeader>
          <CardContent><p className="text-4xl font-bold text-purple-600">{visitedLeads}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Paid</CardTitle></CardHeader>
          <CardContent><p className="text-4xl font-bold text-green-600">{paidLeads}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Total Revenue</CardTitle></CardHeader>
          <CardContent><p className="text-4xl font-bold">${totalRevenue.toFixed(2)}</p></CardContent>
        </Card>
      </div>
    </div>
  );
}
