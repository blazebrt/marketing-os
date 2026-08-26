const fs = require('fs');
const path = require('path');

const write = (p, content) => {
  const full = path.join(process.cwd(), p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.trim() + '\n', 'utf-8');
};

write('src/app/campaigns/page.tsx', `
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
          {campaigns?.map(c => (
            <li key={c.id} className="p-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium">{c.service}</h3>
                <p className="text-sm text-gray-500">{c.offer}</p>
                <div className="mt-1 flex space-x-2 text-xs">
                  <span className="bg-gray-100 text-gray-800 px-2 rounded">{c.status}</span>
                  <span className="text-gray-500">₹{c.max_daily_spend}/day</span>
                </div>
              </div>
              <Link href={\`/campaigns/\${c.id}\`} className="text-blue-600 text-sm">View</Link>
            </li>
          ))}
          {!campaigns?.length && <div className="p-8 text-center text-gray-500">No campaigns found. Let's create your first one.</div>}
        </ul>
      </div>
    </div>
  );
}
`);

write('src/app/campaigns/[id]/page.tsx', `
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { verifyCampaign, approveCampaign } from '../actions';

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const id = resolvedParams.id;
  
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  const { data: campaign } = await supabase.from('unified_campaigns').select('*').eq('id', id).single();
  if (!campaign) return redirect('/campaigns');

  const { data: deployments } = await supabase.from('channel_deployments').select('*').eq('campaign_id', id);

  let verification: any = null;
  if (campaign.status === 'DRAFT') {
    verification = await verifyCampaign(id);
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Campaign: {campaign.service}</h1>
      <span className="inline-block bg-blue-100 text-blue-800 text-sm px-2 py-1 rounded mb-8">{campaign.status}</span>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="p-4 bg-gray-50 rounded">
          <p className="text-sm text-gray-500">Offer</p>
          <p className="font-medium">{campaign.offer}</p>
        </div>
        <div className="p-4 bg-gray-50 rounded">
          <p className="text-sm text-gray-500">Max Daily Spend</p>
          <p className="font-medium">₹{campaign.max_daily_spend}</p>
        </div>
        <div className="p-4 bg-gray-50 rounded">
          <p className="text-sm text-gray-500">Duration</p>
          <p className="font-medium">{campaign.duration_days} days</p>
        </div>
        <div className="p-4 bg-gray-50 rounded">
          <p className="text-sm text-gray-500">Channels</p>
          <p className="font-medium">{campaign.channels.join(', ')}</p>
        </div>
      </div>

      {campaign.status === 'DRAFT' && verification && (
        <div className="mb-8 border p-6 rounded-lg bg-white shadow-sm">
          <h2 className="text-xl font-bold mb-4">Pre-launch Verification</h2>
          <ul className="space-y-2 mb-6">
            {verification.checks.map((c: any, i: number) => (
              <li key={i} className="flex items-center">
                <span className={\`mr-2 font-bold \${c.pass ? 'text-green-600' : 'text-red-600'}\`}>
                  {c.pass ? '✓' : '✗'}
                </span>
                <span>{c.name}: <span className="text-gray-600 text-sm">{c.message}</span></span>
              </li>
            ))}
          </ul>
          
          {verification.allPass ? (
            <form action={async () => {
              'use server';
              await approveCampaign(id);
            }}>
              <button className="bg-black text-white px-6 py-3 rounded-lg font-medium">Approve & Prepare</button>
            </form>
          ) : (
            <div className="p-4 bg-red-50 text-red-700 rounded border border-red-100">
              Please fix the issues above before you can approve this campaign.
            </div>
          )}
        </div>
      )}

      {deployments && deployments.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-4">Channel Deployments</h2>
          <div className="space-y-2">
            {deployments.map(d => (
              <div key={d.id} className="p-4 border rounded flex justify-between">
                <span className="font-medium capitalize">{d.provider}</span>
                <span className="bg-gray-100 px-2 py-1 text-sm rounded">{d.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
`);
console.log('UI Scaffold generated.');
