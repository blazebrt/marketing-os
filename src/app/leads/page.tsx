import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { updateLeadStatus, updateLeadRevenue } from './actions';

export default async function LeadsPage() {
  const supabase = await createClient();
  
  // Fetch Leads securely (RLS enforced)
  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Lead Pipeline</h1>
      
      <div className="grid gap-4">
        {leads?.map((lead) => (
          <Card key={lead.id}>
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle>{lead.name || 'Unknown User'}</CardTitle>
                  <p className="text-sm text-gray-500">{lead.phone} | {lead.email}</p>
                </div>
                <div className="flex gap-2">
                  <form action={updateLeadStatus.bind(null, lead.id, lead.status, 'CONTACTED')}>
                    <Button variant="outline" size="sm">Mark Contacted</Button>
                  </form>
                  <form action={updateLeadStatus.bind(null, lead.id, lead.status, 'BOOKED')}>
                    <Button variant="outline" size="sm">Mark Booked</Button>
                  </form>
                  <form action={updateLeadStatus.bind(null, lead.id, lead.status, 'PAID')}>
                    <Button variant="default" size="sm">Mark Paid</Button>
                  </form>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 text-sm gap-4">
                <div>
                  <p><strong>Status:</strong> {lead.status}</p>
                  <p><strong>Revenue:</strong> ${lead.revenue_amount || 0}</p>
                </div>
                <div>
                  <p><strong>Channel:</strong> {lead.source_channel || 'Organic'}</p>
                  <p><strong>Campaign:</strong> {lead.campaign_name || 'N/A'}</p>
                  <p className="text-xs text-gray-400 truncate">fbclid: {lead.fbclid || 'None'}</p>
                  <p className="text-xs text-gray-400 truncate">utm_source: {lead.utm_source || 'None'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {(!leads || leads.length === 0) && (
          <p className="text-gray-500 text-center py-12">No leads found.</p>
        )}
      </div>
    </div>
  );
}
