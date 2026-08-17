import { createClient } from './supabase/server';
import { logAudit } from './audit';

export async function checkSpendingGuardrails(
  campaignId: string, 
  proposedIncrease: number,
  actor: string
): Promise<{ safe: boolean; reason?: string }> {
  const supabase = await createClient();

  // 1. Fetch Campaign State
  const { data: campaign, error: campaignError } = await supabase
    .from('unified_campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();

  if (campaignError || !campaign) {
    return { safe: false, reason: 'Campaign not found or database error. Fail-closed.' };
  }

  // 2. Fail-Closed: Never increase if status is uncertain/error
  if (['draft', 'completed', 'paused'].includes(campaign.status)) {
    return { safe: false, reason: `Cannot increase spend for campaign in status: ${campaign.status}` };
  }

  // 3. Check integration health (e.g., Meta/Google connection status)
  const { data: integrations, error: intError } = await supabase
    .from('integrations')
    .select('status')
    .in('provider', ['meta', 'google']);

  if (intError || integrations.some(i => i.status !== 'connected')) {
    return { safe: false, reason: 'One or more ad integrations are disconnected or in error. Fail-closed.' };
  }

  // 4. Budget Guardrails
  const newBudget = campaign.budget_amount + proposedIncrease;
  
  if (campaign.max_auto_budget_increase && proposedIncrease > campaign.max_auto_budget_increase) {
    return { safe: false, reason: 'Proposed increase exceeds max_auto_budget_increase limit.' };
  }

  if (campaign.max_campaign_spend && newBudget > campaign.max_campaign_spend) {
    return { safe: false, reason: 'Proposed increase exceeds max_campaign_spend limit.' };
  }

  // Safe to proceed
  await logAudit(actor, 'BUDGET_INCREASE_CHECK', 'unified_campaign', campaignId, 
    { current_budget: campaign.budget_amount }, 
    { proposed_budget: newBudget }, 
    'Guardrails passed'
  );

  return { safe: true };
}
