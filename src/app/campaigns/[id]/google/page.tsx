import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { GoogleCreativeItem } from '@/lib/providers/google/types';
import { Bot } from 'lucide-react';
import { CreativeItemRow } from './CreativeItemRow';
import { GoogleAdsReadOnlyContextProvider } from '@/lib/providers/google/real-context';
import { DeploymentPanel } from './DeploymentPanel';
import { ReviewProgress, countItems } from './ReviewProgress';

export default async function GoogleReviewPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: campaign } = await supabase
    .from('unified_campaigns')
    .select('*')
    .eq('id', params.id)
    .eq('owner_id', user.id)
    .single();

  if (!campaign || campaign.owner_id !== user.id) {
    return <div>Campaign not found or unauthorized</div>;
  }

  let creativeGoogle = null;
  if (campaign.creative_id) {
    const { data } = await supabase
      .from('creatives_google')
      .select('*')
      .eq('creative_id', campaign.creative_id)
      .eq('owner_id', user.id)
      .single();
    creativeGoogle = data;
  }

  const headlines: GoogleCreativeItem[] = creativeGoogle?.headlines || [];
  const descriptions: GoogleCreativeItem[] = creativeGoogle?.descriptions || [];
  const keywords: GoogleCreativeItem[] = creativeGoogle?.keywords || [];

  const sections = [
    countItems('Headlines', headlines),
    countItems('Descriptions', descriptions),
    countItems('Keywords', keywords),
  ];

  let strategyContext = null;
  let targetStateError = null;
  let currentTargetState = null;

  try {
    const contextProvider = new GoogleAdsReadOnlyContextProvider();
    strategyContext = await contextProvider.getStrategyContext(user.id);
  } catch {
    targetStateError = 'GOOGLE_CONTEXT_UNAVAILABLE';
  }

  let deploymentState = null;
  const { data: depData } = await supabase
    .from('channel_deployments')
    .select('*')
    .eq('campaign_id', campaign.id)
    .eq('provider', 'google')
    .eq('owner_id', user.id)
    .single();
  if (depData) {
    deploymentState = depData;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Google Campaign Review</h1>
        <p className="text-muted-foreground mt-2">
          Review AI-generated copy. Approved creatives are not live on Google Ads until deployment reconciles as MATCH.
        </p>
      </div>

      <div className="bg-white p-6 rounded-lg border shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold border-b pb-2">
          <Bot className="w-5 h-5 text-blue-500" />
          Bidding Recommendation Context
        </div>
        {targetStateError ? (
          <div className="text-red-600 bg-red-50 p-4 rounded border border-red-200">
            <strong>Error retrieving Google Account Context:</strong> GOOGLE_CONTEXT_UNAVAILABLE
          </div>
        ) : strategyContext ? (
          <div className="space-y-2 text-sm">
            <p><strong>Conversions (30d):</strong> {strategyContext.conversionCount}</p>
            <p><strong>Account Age (Days):</strong> {strategyContext.accountAgeDays}</p>
            <p><strong>Tracking Reliability:</strong> {strategyContext.conversionTrackingReliability}</p>
          </div>
        ) : null}
      </div>

      <ReviewProgress sections={sections} />

      <div className="space-y-6">
        <CreativeSection title="Headlines" items={headlines} campaignId={campaign.id} creativeId={campaign.creative_id} itemType="headlines" />
        <CreativeSection title="Descriptions" items={descriptions} campaignId={campaign.id} creativeId={campaign.creative_id} itemType="descriptions" />
        <CreativeSection title="Keywords" items={keywords} campaignId={campaign.id} creativeId={campaign.creative_id} itemType="keywords" />
      </div>

      {campaign.status !== 'READY_TO_DEPLOY' && (
        <div className="bg-yellow-50 text-yellow-800 p-4 rounded-md border border-yellow-200">
          Campaign is not ready to deploy. Current campaign status: {campaign.status}. Deployment is shown only after approval snapshots target_state.
        </div>
      )}

      {campaign.status === 'READY_TO_DEPLOY' && deploymentState?.status === 'READY_TO_DEPLOY' && deploymentState?.target_state?.headlines && (
        <DeploymentPanel
          campaignId={campaign.id}
          status={campaign.status}
          deploymentState={deploymentState}
        />
      )}
    </div>
  );
}

function CreativeSection({ 
  title, 
  items, 
  campaignId, 
  creativeId, 
  itemType 
}: { 
  title: string, 
  items: GoogleCreativeItem[], 
  campaignId: string, 
  creativeId: string,
  itemType: 'headlines' | 'descriptions' | 'keywords'
}) {
  if (items.length === 0) {
    return (
      <div className="bg-white p-6 rounded-lg border shadow-sm">
        <h2 className="text-xl font-semibold mb-4">{title}</h2>
        <p className="text-muted-foreground text-sm">
          No {title.toLowerCase()} written yet. Use Generate AI Creatives on the campaign page.
        </p>
      </div>
    );
  }

  const pending = items.filter((i) => i.owner_approved !== true && !i.rejected).length;

  return (
    <div className="bg-white p-6 rounded-lg border shadow-sm">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">{title}</h2>
        <span className={`text-sm ${pending === 0 ? 'text-green-700' : 'text-amber-700 font-medium'}`}>
          {pending === 0 ? 'All decided' : `${pending} awaiting decision`}
        </span>
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <CreativeItemRow 
            key={item.id} 
            campaignId={campaignId} 
            creativeId={creativeId} 
            itemType={itemType} 
            item={item} 
          />
        ))}
      </div>
    </div>
  );
}
