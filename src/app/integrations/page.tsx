import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  // Client securely fetches ONLY metadata.
  // Credentials do not exist in this table anymore.
  const { data: integrations } = await supabase
    .from('integrations')
    .select('provider, status, external_id, last_verified_at, error_message')
    .eq('owner_id', user.id);

  const getMetadata = (provider: string): any => {
    const int = integrations?.find((i: any) => i.provider === provider);
    return int || { status: 'disconnected', external_id: null, error_message: null };
  };

  const providers = [
    { id: 'google', name: 'Google Ads', description: 'Search and Performance Max campaigns', testAccounts: 'Manager: 595-645-2500, Customer: 160-026-9431' },
    { id: 'meta', name: 'Meta Ads', description: 'Facebook and Instagram advertising' },
    { id: 'instagram', name: 'Instagram', description: 'Organic creative syncing' },
    { id: 'whatsapp', name: 'WhatsApp', description: 'WhatsApp Business API' },
    { id: 'website', name: 'Website', description: 'Lead attribution via secure API' }
  ];

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Integrations</h1>
      <p className="mb-8 text-gray-600">Securely connect your advertising and tracking channels. Credentials are encrypted server-side and never exposed to the browser.</p>
      
      <div className="space-y-4">
        {providers.map(p => {
          const meta = getMetadata(p.id);
          const status = meta.status;
          return (
            <div key={p.id} className="border p-6 rounded-lg flex items-center justify-between bg-white shadow-sm">
              <div>
                <h3 className="font-semibold text-lg">{p.name}</h3>
                <p className="text-gray-500 text-sm">{p.description}</p>
                {p.testAccounts && <p className="text-xs text-blue-500 mt-1">V1 Bound to: {p.testAccounts}</p>}
                
                {meta.external_id && <p className="text-sm font-medium mt-2 text-green-700">Account: {meta.external_id}</p>}
                {!meta.external_id && status === 'connected' && p.id === 'google' && (
                  <p className="text-sm font-medium mt-2 text-yellow-600">Google OAuth connected — Ads account verification pending</p>
                )}
                {meta.error_message && <p className="text-sm font-medium mt-2 text-red-600">Error: {meta.error_message}</p>}
              </div>
              <div className="flex items-center gap-4">
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  status === 'connected' ? 'bg-green-100 text-green-800' :
                  status === 'error' ? 'bg-red-100 text-red-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {status.toUpperCase()}
                </span>
                
                {status === 'connected' ? (
                  <form action="/api/integrations/disconnect" method="POST">
                    <input type="hidden" name="provider" value={p.id} />
                    <button type="submit" className="px-4 py-2 bg-red-50 text-red-600 rounded-md text-sm font-medium hover:bg-red-100">
                      Disconnect
                    </button>
                  </form>
                ) : (
                  <a 
                    href={p.id === 'google' ? '/api/integrations/google/connect' : '#'}
                    className="px-4 py-2 bg-black text-white rounded-md text-sm font-medium hover:bg-gray-800"
                  >
                    Connect
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
