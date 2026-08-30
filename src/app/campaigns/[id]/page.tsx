import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { verifyCampaign } from '../actions';
import { GenerateCreativesButton } from './GenerateCreativesButton';
import { VerificationPanel } from './VerificationPanel';

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const id = resolvedParams.id;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  const { data: campaign } = await supabase
    .from('unified_campaigns')
    .select('*')
    .eq('id', id)
    .eq('owner_id', user.id)
    .single();
  if (!campaign) return redirect('/campaigns');

  const { data: deployments } = await supabase
    .from('channel_deployments')
    .select('*')
    .eq('campaign_id', id)
    .eq('owner_id', user.id);

  let verification: { checks: { name: string; pass: boolean; message: string }[]; allPass: boolean } | null = null;
  if (campaign.status === 'DRAFT' || campaign.status === 'PENDING_APPROVAL') {
    verification = await verifyCampaign(id, { checkReachability: false });
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
        <div className="p-4 bg-gray-50 rounded">
          <p className="text-sm text-gray-500">Destination type</p>
          <p className="font-medium">{campaign.destination_type || campaign.destination}</p>
        </div>
        <div className="p-4 bg-gray-50 rounded">
          <p className="text-sm text-gray-500">Landing URL</p>
          <p className="font-medium">{campaign.landing_url || '—'}</p>
        </div>
      </div>

      {campaign.status !== 'READY_TO_DEPLOY' && campaign.status !== 'LIVE' && (
        <p className="text-sm text-slate-600 mb-6">
          Approving copy does not put anything on Google Ads. Nothing runs until you set the
          campaign up in Google yourself.
        </p>
      )}

      {(campaign.status === 'READY_TO_DEPLOY' || campaign.status === 'LIVE') && (
        <div className={`mb-8 rounded-lg border p-5 ${campaign.status === 'LIVE' ? 'border-green-200 bg-green-50' : 'border-blue-200 bg-blue-50'}`}>
          <h2 className="font-semibold">
            {campaign.status === 'LIVE' ? 'This campaign is live in Google Ads' : 'Ready to set up in Google Ads'}
          </h2>
          <p className="mt-1 max-w-prose text-sm">
            {campaign.status === 'LIVE'
              ? 'Its performance is collected each night. Open the setup sheet to check the details or correct the campaign ID.'
              : 'Everything has been approved. The setup sheet has every value you need to create this campaign in Google, ready to copy.'}
          </p>
          <a
            href={`/campaigns/${id}/launch`}
            className="mt-4 inline-block rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white"
          >
            {campaign.status === 'LIVE' ? 'Open setup sheet' : 'Open setup sheet'}
          </a>
        </div>
      )}

      {(campaign.status === 'DRAFT' || campaign.status === 'PENDING_APPROVAL') && verification && (
        <>
          <VerificationPanel
            campaignId={id}
            status={campaign.status}
            checks={verification.checks}
            allPass={verification.allPass}
          />
          {!campaign.creative_id && (
            <div className="mb-8">
              <GenerateCreativesButton campaignId={id} />
            </div>
          )}
          {campaign.creative_id && (
            <a href={`/campaigns/${id}/google`} className="inline-block text-center bg-blue-100 text-blue-700 px-6 py-3 rounded-lg font-medium border border-blue-200 hover:bg-blue-200 mb-8">
              Review Google Creatives
            </a>
          )}
        </>
      )}

      {deployments && deployments.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-4">Channel Deployments</h2>
          <div className="space-y-2">
            {deployments.map((d: { id: string; provider: string; status: string }) => (
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
