import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { GoogleCreativeItem } from '@/lib/providers/google/types';
import { Bot } from 'lucide-react';
import { CreativeItemRow } from './CreativeItemRow';
import { prepareGoogleDeployment } from '@/lib/providers/google/adapter';
import { GoogleAdsReadOnlyContextProvider } from '@/lib/providers/google/real-context';
import { DeploymentPanel } from './DeploymentPanel';

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
      .single();
    creativeGoogle = data;
  }

  const headlines: GoogleCreativeItem[] = creativeGoogle?.headlines || [];
  const descriptions: GoogleCreativeItem[] = creativeGoogle?.descriptions || [];
  const keywords: GoogleCreativeItem[] = creativeGoogle?.keywords || [];

  let strategyContext = null;
  let targetStateError = null;
  let currentTargetState = null;

  try {
    const contextProvider = new GoogleAdsReadOnlyContextProvider();
    strategyContext = await contextProvider.getStrategyContext(user.id);
  } catch (e: any) {
    targetStateError = e.message;
  }

  let deploymentState = null;
  const { data: depData } = await supabase
    .from('channel_deployments')
    .select('*')
    .eq('campaign_id', campaign.id)
    .eq('provider', 'google')
    .single();
  if (depData) {
    deploymentState = depData;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Google Campaign Review</h1>
        <p className="text-muted-foreground mt-2">
          Review and approve AI-generated marketing content before deployment.
        </p>
      </div>

      <div className="bg-white p-6 rounded-lg border shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold border-b pb-2">
          <Bot className="w-5 h-5 text-blue-500" />
          Bidding Recommendation Context
        </div>
        {targetStateError ? (
          <div className="text-red-600 bg-red-50 p-4 rounded border border-red-200">
            <strong>Error retrieving Google Account Context:</strong> {targetStateError}
          </div>
        ) : strategyContext ? (
          <div className="space-y-2 text-sm">
            <p><strong>Conversions (30d):</strong> {strategyContext.conversionCount}</p>
            <p><strong>Account Age (Days):</strong> {strategyContext.accountAgeDays}</p>
            <p><strong>Tracking Reliability:</strong> {strategyContext.conversionTrackingReliability}</p>
          </div>
        ) : null}
      </div>

      <div className="space-y-6">
        <CreativeSection title="Headlines" items={headlines} campaignId={campaign.id} creativeId={campaign.creative_id} itemType="headlines" />
        <CreativeSection title="Descriptions" items={descriptions} campaignId={campaign.id} creativeId={campaign.creative_id} itemType="descriptions" />
        <CreativeSection title="Keywords" items={keywords} campaignId={campaign.id} creativeId={campaign.creative_id} itemType="keywords" />
      </div>

      {campaign.status !== 'READY_TO_DEPLOY' && !deploymentState?.status && (
        <div className="bg-yellow-50 text-yellow-800 p-4 rounded-md border border-yellow-200">
          Campaign must be approved before final deployment prep can occur. Current status: {campaign.status}
        </div>
      )}

      {(campaign.status === 'READY_TO_DEPLOY' || deploymentState) && (
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
        <p className="text-muted-foreground text-sm">No items generated yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg border shadow-sm">
      <h2 className="text-xl font-semibold mb-4">{title}</h2>
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
