import { createClient } from './supabase/server';
import { logAudit } from './audit';

export async function checkSpendingGuardrails(
  campaignId: string,
  proposedIncrease: number,
  actor: string
): Promise<{ safe: boolean; reason?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id !== actor) {
    return { safe: false, reason: 'Unauthorized. Fail-closed.' };
  }

  if (!Number.isFinite(proposedIncrease) || proposedIncrease <= 0) {
    return { safe: false, reason: 'Proposed increase is not a positive finite amount. Fail-closed.' };
  }

  const { data: campaign, error: campaignError } = await supabase
    .from('unified_campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('owner_id', user.id)
    .single();

  if (campaignError || !campaign) {
    return { safe: false, reason: 'Campaign not found or database error. Fail-closed.' };
  }

  if (campaign.status !== 'ACTIVE' && campaign.status !== 'LIVE') {
    return { safe: false, reason: `Cannot increase spend for campaign in status: ${campaign.status}` };
  }

  const { data: integrations, error: intError } = await supabase
    .from('integrations')
    .select('status')
    .eq('owner_id', user.id)
    .in('provider', ['meta', 'google']);

  if (intError || !integrations || integrations.some((i: { status: string }) => i.status !== 'connected')) {
    return { safe: false, reason: 'One or more ad integrations are disconnected or in error. Fail-closed.' };
  }

  const currentBudget = Number(campaign.budget_amount);
  const newBudget = currentBudget + proposedIncrease;
  if (!Number.isFinite(currentBudget) || !Number.isFinite(newBudget)) {
    return { safe: false, reason: 'Campaign budget is not a usable number. Fail-closed.' };
  }

  const maxAuto = Number(campaign.max_auto_budget_increase);
  if (!Number.isFinite(maxAuto) || proposedIncrease > maxAuto) {
    return { safe: false, reason: 'Proposed increase exceeds max_auto_budget_increase limit.' };
  }

  if (campaign.max_campaign_spend && newBudget > Number(campaign.max_campaign_spend)) {
    return { safe: false, reason: 'Proposed increase exceeds max_campaign_spend limit.' };
  }

  await logAudit(user.id, 'BUDGET_INCREASE_CHECK', 'unified_campaign', campaignId,
    { current_budget: campaign.budget_amount },
    { proposed_budget: newBudget },
    'Guardrails passed'
  );

  return { safe: true };
}
