import { evaluateBiddingStrategy } from './strategy';
import { validateKeyword, validateHeadline, validateDescription } from './validation';
import { GoogleTargetState, GoogleCreativeItem } from './types';
import { GoogleAccountContextProvider } from './context';
import { GoogleAdsReadOnlyContextProvider } from './real-context';

export async function prepareGoogleDeployment(
  supabase: any,
  campaignId: string,
  contextProvider?: GoogleAccountContextProvider
): Promise<GoogleTargetState> {
  const provider = contextProvider || new GoogleAdsReadOnlyContextProvider(supabase);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized: No user session');

  // 1. Load unified campaign
  const { data: campaign, error: campaignErr } = await supabase
    .from('unified_campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();

  if (campaignErr || !campaign) throw new Error('Campaign not found or unauthorized');

  // 2. Verify campaign ownership
  if (campaign.owner_id !== user.id) throw new Error('Campaign ownership invalid');

  // 3. Verify campaign state is READY_TO_DEPLOY or APPROVED
  if (campaign.status !== 'READY_TO_DEPLOY' && campaign.status !== 'APPROVED') {
    throw new Error('Invalid campaign state');
  }

  // 4. Verify Google integration is connected
  const { data: integration } = await supabase
    .from('integrations')
    .select('*')
    .eq('owner_id', user.id)
    .eq('provider', 'google')
    .single();

  if (!integration || integration.status !== 'connected') {
    throw new Error('Google integration disconnected or missing');
  }

  // 5. Verify channel deployment mapping exists
  const { data: deployment } = await supabase
    .from('channel_deployments')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('provider', 'google')
    .single();

  if (!deployment) {
    throw new Error('Google channel deployment missing');
  }

  // 6. Verify creative exists
  if (!campaign.creative_id) {
    throw new Error('Creative missing');
  }

  const { data: creativeGoogle } = await supabase
    .from('creatives_google')
    .select('*')
    .eq('creative_id', campaign.creative_id)
    .single();

  if (!creativeGoogle) {
    throw new Error('Creative missing or Google creative data not found');
  }

  // Filter out rejected items
  const headlines: GoogleCreativeItem[] = (creativeGoogle.headlines || []).filter((i: GoogleCreativeItem) => !i.rejected);
  const descriptions: GoogleCreativeItem[] = (creativeGoogle.descriptions || []).filter((i: GoogleCreativeItem) => !i.rejected);
  const keywords: GoogleCreativeItem[] = (creativeGoogle.keywords || []).filter((i: GoogleCreativeItem) => !i.rejected);

  if (headlines.length === 0 || descriptions.length === 0 || keywords.length === 0) {
    throw new Error('Creative missing required headlines, descriptions, or keywords');
  }

  // 7. Validate budget and destination
  if (campaign.budget_amount <= 0) throw new Error('Budget invalid');
  if (!campaign.destination) throw new Error('Destination invalid');

  // 8. Validate AI-generated items are approved and valid
  // Ensure uniqueness
  const seenHeadlines = new Set();
  for (const hl of headlines) {
    if (!hl.owner_approved) throw new Error('AI-generated headline unapproved');
    const errs = validateHeadline(hl);
    if (errs.length > 0) throw new Error(`Invalid headline: ${errs.join(', ')}`);
    
    const normalized = hl.current_value.trim().toLowerCase();
    if (seenHeadlines.has(normalized)) throw new Error('Duplicate headline content rejected');
    seenHeadlines.add(normalized);
  }

  const seenDescriptions = new Set();
  for (const desc of descriptions) {
    if (!desc.owner_approved) throw new Error('AI-generated description unapproved');
    const errs = validateDescription(desc);
    if (errs.length > 0) throw new Error(`Invalid description: ${errs.join(', ')}`);

    const normalized = desc.current_value.trim().toLowerCase();
    if (seenDescriptions.has(normalized)) throw new Error('Duplicate description content rejected');
    seenDescriptions.add(normalized);
  }

  const seenKeywords = new Set();
  for (const kw of keywords) {
    if (!kw.owner_approved) throw new Error('AI-generated keyword unapproved');
    const errs = validateKeyword(kw);
    if (errs.length > 0) throw new Error(`Invalid keyword: ${errs.join(', ')}`);
    
    const normalized = kw.current_value.trim().toLowerCase();
    if (seenKeywords.has(normalized)) throw new Error('Duplicate keyword rejected');
    seenKeywords.add(normalized);
  }

  // 9. Evaluate bidding strategy
  // Uses injected provider. production throws if context unavailable.
  const strategyContext = await provider.getStrategyContext(user.id);
  const strategyRecommendation = evaluateBiddingStrategy(strategyContext);

  if (!strategyRecommendation || !strategyRecommendation.strategy) {
    throw new Error('Strategy context invalid');
  }

  // 10. Construct target_state atomically in-memory (NO SECRETS EXPOSED)
  const targetState: GoogleTargetState = {
    schemaVersion: 'v1',
    provider: 'google',
    campaign: {
      id: campaign.id,
      budget: campaign.budget_amount,
      duration: campaign.duration_days,
      destination: campaign.destination
    },
    bidding: {
      strategy: strategyRecommendation.strategy,
      confidence: strategyRecommendation.confidence,
      reasons: strategyRecommendation.reasons,
      safetyConstraints: strategyRecommendation.safetyConstraints
    },
    adGroup: {
      name: `${campaign.name} - Google`,
      type: 'SEARCH_STANDARD'
    },
    keywords,
    headlines,
    descriptions,
    destination: {
      url: campaign.destination,
      tracking: 'utm_source=google&utm_medium=cpc'
    },
    generatedAt: new Date().toISOString()
  };

  // 11. Persist target_state back to channel_deployments atomically
  const { error: updateErr } = await supabase
    .from('channel_deployments')
    .update({ 
      target_state: targetState,
      updated_at: new Date().toISOString()
    })
    .eq('campaign_id', campaign.id)
    .eq('provider', 'google');

  if (updateErr) {
    throw new Error('Failed to persist target_state: ' + updateErr.message);
  }

  // Audit event
  await supabase.from('audit_logs').insert({
    owner_id: user.id,
    action: 'GOOGLE_TARGET_STATE_PREPARED',
    resource_type: 'campaign',
    resource_id: campaign.id,
    details: { strategy: targetState.bidding.strategy }
  });

  return targetState;
}
