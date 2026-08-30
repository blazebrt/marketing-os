import { createClient } from './supabase/server';

export type PrelaunchCheckResult = {
  passed: boolean;
  errors: string[];
};

export async function runPrelaunchVerification(campaignId: string): Promise<PrelaunchCheckResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const errors: string[] = [];

  if (!user) {
    return { passed: false, errors: ['Unauthorized.'] };
  }

  const { data: campaign } = await supabase
    .from('unified_campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('owner_id', user.id)
    .single();

  if (!campaign) {
    return { passed: false, errors: ['Campaign not found.'] };
  }

  const { data: integrations } = await supabase
    .from('integrations')
    .select('provider, status')
    .eq('owner_id', user.id);

  const requiredProviders = (campaign.channels || []).map((c: string) => String(c).toLowerCase());
  requiredProviders.forEach((provider: string) => {
    const integration = integrations?.find((i: { provider: string }) => i.provider === provider);
    if (!integration || integration.status !== 'connected') {
      errors.push(`Integration '${provider}' is not connected.`);
    }
  });

  if (!campaign.service || !campaign.offer || Number(campaign.budget_amount) <= 0) {
    errors.push('Campaign missing core requirements (service, offer, or valid budget).');
  }

  const { data: deployments } = await supabase
    .from('channel_deployments')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('owner_id', user.id);

  if (!deployments || deployments.length === 0) {
    errors.push('No channels selected for deployment.');
  } else {
    for (const deployment of deployments) {
      if (deployment.provider === 'google') {
        const { data: googleCreative } = await supabase
          .from('creatives_google')
          .select('*')
          .eq('owner_id', user.id)
          .eq('creative_id', campaign.creative_id)
          .maybeSingle();

        if (!googleCreative) {
          errors.push('Google Ads deployment missing creatives.');
        } else {
          const keywords = Array.isArray(googleCreative.keywords) ? googleCreative.keywords : [];
          const unapproved = keywords.some((kw: { ai_generated?: boolean; owner_approved?: boolean }) =>
            kw.ai_generated && kw.owner_approved !== true
          );
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
