import { createClient } from './supabase/server';

export type PrelaunchCheckResult = {
  passed: boolean;
  errors: string[];
};

export async function runPrelaunchVerification(campaignId: string): Promise<PrelaunchCheckResult> {
  const supabase = await createClient();
  const errors: string[] = [];

  // 1. Fetch Campaign
  const { data: campaign } = await supabase
    .from('unified_campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();

  if (!campaign) {
    return { passed: false, errors: ['Campaign not found.'] };
  }

  // 2. Connection Test
  const { data: integrations } = await supabase
    .from('integrations')
    .select('provider, status');
  
  const requiredProviders = ['meta', 'website']; // Assuming Meta and Website are always required
  requiredProviders.forEach(provider => {
    const integration = integrations?.find((i: any) => i.provider === provider);
    if (!integration || integration.status !== 'connected') {
      errors.push(`Integration '${provider}' is not connected.`);
    }
  });

  // 3. Attribution Test (Check if we have recent interactions)
  const { count } = await supabase
    .from('marketing_interactions')
    .select('*', { count: 'exact', head: true });
    
  if (count === 0) {
    errors.push('No recent marketing interactions recorded. Tracking pixel or webhooks might be down.');
  }

  // 4. Configuration Validation
  if (!campaign.service || !campaign.offer || campaign.budget_amount <= 0) {
    errors.push('Campaign missing core requirements (service, offer, or valid budget).');
  }

  // Fetch Deployments & Creatives
  const { data: deployments } = await supabase
    .from('channel_deployments')
    .select('*')
    .eq('unified_campaign_id', campaignId);

  if (!deployments || deployments.length === 0) {
    errors.push('No channels selected for deployment.');
  } else {
    for (const deployment of deployments) {
      if (deployment.channel === 'google') {
        const { data: googleCreative } = await supabase
          .from('creatives_google')
          .select('*')
          .eq('channel_deployment_id', deployment.id)
          .single();
          
        if (!googleCreative) {
          errors.push('Google Ads deployment missing creatives.');
        } else {
          // Check if AI generated keywords are owner approved
          const keywords = googleCreative.keywords as any[];
          const unapproved = keywords?.some(kw => kw.ai_generated && !kw.owner_approved);
          if (unapproved) {
            errors.push('Google Ads deployment contains unapproved AI-generated keywords.');
          }
        }
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors
  };
}
