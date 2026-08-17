import { createClient } from '@/lib/supabase/server';
import { evaluateBiddingStrategy } from './strategy';

export class GoogleAdsAdapter {
  /**
   * Mock authentication to verify the connection.
   */
  async verifyConnection(): Promise<boolean> {
    const supabase = await createClient();
    const { data: integration } = await supabase
      .from('integrations')
      .select('*')
      .eq('provider', 'google')
      .single();

    return integration?.status === 'connected';
  }

  /**
   * Idempotent preparation of Google deployment.
   * Throws an error if creatives/keywords are unapproved.
   * Does NOT make live API calls.
   */
  async prepareDeployment(channelDeploymentId: string): Promise<boolean> {
    const supabase = await createClient();

    // 1. Fetch deployment & creatives
    const { data: deployment } = await supabase
      .from('channel_deployments')
      .select('*, unified_campaigns(*)')
      .eq('id', channelDeploymentId)
      .single();

    const { data: creatives } = await supabase
      .from('creatives_google')
      .select('*')
      .eq('channel_deployment_id', channelDeploymentId)
      .single();

    if (!deployment || !creatives) {
      throw new Error('Missing deployment or creative configuration.');
    }

    // 2. Validate explicit owner approval
    const keywords = creatives.keywords as { keyword: string; owner_approved: boolean }[];
    const unapprovedKw = keywords.some(kw => !kw.owner_approved);
    
    if (unapprovedKw) {
      throw new Error('Cannot deploy: Contains unapproved AI-generated keywords.');
    }

    // 3. Determine safe strategy using the Comprehensive Evaluator
    const strategyContext = {
      campaignType: 'SEARCH',
      campaignObjective: 'LEAD_GENERATION',
      historicalConversions30Days: 0, // Mocked for V1 prep
      conversionReliabilityScore: 0.0,
      accountAgeDays: 30,
      hasGoogleAdsRecommendations: false
    };
    const recommendation = evaluateBiddingStrategy(strategyContext);
    
    // 4. Budget Guardrails check
    const campaign = deployment.unified_campaigns as any;
    if (deployment.channel_specific_allocation > campaign.max_campaign_spend) {
      throw new Error('Cannot deploy: Channel allocation exceeds max campaign spend.');
    }

    // 5. Build configuration (Mocking Google Ads API payload generation)
    const googlePayload = {
      campaign: {
        name: `${campaign.service} - ${campaign.id}`,
        biddingStrategyType: recommendation.strategy,
        budgetAmountMicros: deployment.channel_specific_allocation * 1000000,
      },
      adGroup: {
        name: 'Default Ad Group',
      },
      ad: {
        headlines: creatives.headlines,
        descriptions: creatives.descriptions,
      },
      keywords: keywords.map(kw => kw.keyword),
      // Auditability: Preserve strategy recommendation reasoning in the state
      strategy_reasoning: recommendation
    };

    // 6. Idempotency: Save target state 
    // In production, we would call the Google Ads API here.
    // For Milestone 5, we just persist the target state.
    await supabase.from('channel_deployments').update({
      target_state: googlePayload,
      reconciliation_status: 'ready_for_sync'
    }).eq('id', channelDeploymentId);

    return true;
  }
}
