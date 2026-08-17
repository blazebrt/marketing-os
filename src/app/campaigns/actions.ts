'use server';

import { createClient } from '@/lib/supabase/server';
import { CampaignIntentSchema } from '@/lib/schemas/campaigns';
import { calculateSafetyLimits } from '@/lib/campaigns/safeguards';
import { logAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';

export async function saveDraftCampaign(payload: any) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const parsed = CampaignIntentSchema.parse(payload);
  const limits = calculateSafetyLimits(parsed.budget_type, parsed.budget_amount, parsed.duration_days);

  const { data, error } = await supabase.from('unified_campaigns').insert({
    owner_id: user.id,
    service: parsed.service,
    offer: parsed.offer,
    budget_type: parsed.budget_type,
    budget_amount: parsed.budget_amount,
    duration_days: parsed.duration_days,
    max_daily_spend: limits.maxDaily,
    max_campaign_spend: limits.maxTotal,
    destination: parsed.destination,
    channels: parsed.channels,
    creative_id: parsed.creative_id || 'mock-creative-id', // V1 placeholder
    status: 'DRAFT'
  }).select('id').single();

  if (error) throw new Error('Database error saving draft');

  await logAudit(user.id, 'CAMPAIGN_CREATED', 'campaign', data.id, null, null, 'Draft campaign created via wizard');
  return data.id;
}

export async function verifyCampaign(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data: campaign } = await supabase.from('unified_campaigns').select('*').eq('id', campaignId).eq('owner_id', user.id).single();
  if (!campaign) throw new Error('Campaign not found');

  const checks = [];
  
  // Budget checks
  try {
    calculateSafetyLimits(campaign.budget_type, Number(campaign.budget_amount), campaign.duration_days);
    checks.push({ name: 'Budget Safety', pass: true, message: 'Budget is within configured safety limits' });
  } catch (e: any) {
    checks.push({ name: 'Budget Safety', pass: false, message: e.message });
  }

  // Creative check
  if (campaign.creative_id) {
    checks.push({ name: 'Creative', pass: true, message: 'Creative attached' });
  } else {
    checks.push({ name: 'Creative', pass: false, message: 'Missing creative' });
  }

  // Destination
  if (campaign.destination) {
    checks.push({ name: 'Destination', pass: true, message: 'Destination configured' });
  } else {
    checks.push({ name: 'Destination', pass: false, message: 'Missing destination' });
  }

  // Integrations check (Mocked using integration_credentials table in real app, we check if they exist)
  const { data: creds } = await supabase.from('integration_credentials').select('provider').eq('owner_id', user.id);
  const connectedProviders = creds?.map((c: any) => c.provider) || [];
  
  for (const channel of campaign.channels) {
    if (connectedProviders.includes(channel.toLowerCase())) {
      checks.push({ name: `Integration: ${channel}`, pass: true, message: `${channel} is securely connected` });
    } else {
      checks.push({ name: `Integration: ${channel}`, pass: false, message: `${channel} is disconnected. Please connect in Settings.` });
    }
  }

  const allPass = checks.every(c => c.pass);
  await logAudit(user.id, 'PRELAUNCH_VERIFICATION', 'campaign', campaignId, null, null, `Verification ${allPass ? 'Passed' : 'Failed'}`);
  
  return { checks, allPass };
}

export async function approveCampaign(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const verification = await verifyCampaign(campaignId);
  if (!verification.allPass) {
    throw new Error('Prelaunch verification failed. Cannot approve.');
  }

  const { data: campaign } = await supabase.from('unified_campaigns').select('channels').eq('id', campaignId).eq('owner_id', user.id).single();

  // Atomically update state
  const { error } = await supabase.from('unified_campaigns')
    .update({ status: 'READY_TO_DEPLOY', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('owner_id', user.id)
    .eq('status', 'DRAFT'); // Ensure state machine progression

  if (error) throw new Error('Failed to approve campaign or invalid state transition');

  // Create channel deployments safely
  for (const provider of campaign?.channels || []) {
    await supabase.from('channel_deployments').insert({
      campaign_id: campaignId,
      owner_id: user.id,
      provider: provider.toLowerCase(),
      status: 'PENDING'
    });
  }

  await logAudit(user.id, 'CAMPAIGN_STATE_CHANGED', 'campaign', campaignId, null, null, 'DRAFT -> READY_TO_DEPLOY');
  await logAudit(user.id, 'CAMPAIGN_APPROVED', 'campaign', campaignId, null, null, 'Campaign approved by owner safely');

  revalidatePath('/campaigns');
  return true;
}
