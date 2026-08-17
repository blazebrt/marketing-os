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

  // NO mock creative ID injected here. We pass exactly what the client sends (undefined or null is fine).
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
    creative_id: parsed.creative_id || null, 
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
  
  // 1. Budget & Duration Safety checks
  try {
    calculateSafetyLimits(campaign.budget_type, Number(campaign.budget_amount), campaign.duration_days);
    checks.push({ name: 'Budget & Duration', pass: true, message: 'Budget and duration are within configured safety bounds' });
  } catch (e: any) {
    checks.push({ name: 'Budget & Duration', pass: false, message: e.message });
  }

  // 2. Creative Check (Requires real DB record)
  if (!campaign.creative_id) {
    checks.push({ name: 'Creative', pass: false, message: 'No creative attached' });
  } else {
    const { data: cr } = await supabase.from('creatives').select('id').eq('id', campaign.creative_id).eq('owner_id', user.id).single();
    if (cr) {
      checks.push({ name: 'Creative', pass: true, message: 'Creative record verified' });
    } else {
      checks.push({ name: 'Creative', pass: false, message: 'Creative record not found or inaccessible' });
    }
  }

  // 3. Destination Check
  if (campaign.destination) {
    checks.push({ name: 'Destination', pass: true, message: 'Destination configured' });
  } else {
    checks.push({ name: 'Destination', pass: false, message: 'Missing destination' });
  }

  // 4. Integrations & Channels Check (Using safe metadata table)
  const { data: creds } = await supabase.from('integrations').select('provider').eq('owner_id', user.id).eq('status', 'connected');
  const connectedProviders = creds?.map((c: any) => c.provider.toLowerCase()) || [];
  
  if (!campaign.channels || campaign.channels.length === 0) {
    checks.push({ name: 'Channels', pass: false, message: 'No channels selected' });
  } else {
    for (const channel of campaign.channels) {
      if (connectedProviders.includes(channel.toLowerCase())) {
        checks.push({ name: `Integration: ${channel}`, pass: true, message: `${channel} connection verified via safe metadata` });
      } else {
        checks.push({ name: `Integration: ${channel}`, pass: false, message: `${channel} is disconnected or missing` });
      }
    }
  }

  // 5. Tracking Readiness Check
  if (campaign.destination?.toLowerCase().includes('website')) {
    if (connectedProviders.includes('website')) {
      checks.push({ name: 'Tracking Readiness', pass: true, message: 'Website tracking integration is active' });
    } else {
      checks.push({ name: 'Tracking Readiness', pass: false, message: 'Website tracking required but disconnected' });
    }
  } else {
    checks.push({ name: 'Tracking Readiness', pass: true, message: 'No explicit tracking setup required for this destination' });
  }

  const allPass = checks.every(c => c.pass);
  await logAudit(user.id, 'PRELAUNCH_VERIFICATION', 'campaign', campaignId, null, null, `Verification ${allPass ? 'Passed' : 'Failed'}`);
  
  return { checks, allPass };
}

export async function requestApproval(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const verification = await verifyCampaign(campaignId);
  if (!verification.allPass) {
    throw new Error('Prelaunch verification failed. Cannot request approval.');
  }

  // Atomic state transition: DRAFT -> PENDING_APPROVAL
  const { error, data } = await supabase.from('unified_campaigns')
    .update({ status: 'PENDING_APPROVAL', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('owner_id', user.id)
    .eq('status', 'DRAFT')
    .select('id').single();

  if (error || !data) throw new Error('State transition to PENDING_APPROVAL failed (must be in DRAFT state)');

  await logAudit(user.id, 'CAMPAIGN_SUBMITTED_FOR_APPROVAL', 'campaign', campaignId, null, null, 'DRAFT -> PENDING_APPROVAL');
  revalidatePath('/campaigns');
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function approveCampaign(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // Verify again before final approval
  const verification = await verifyCampaign(campaignId);
  if (!verification.allPass) {
    throw new Error('Prelaunch verification failed. Cannot approve.');
  }

  // Atomic state transition: PENDING_APPROVAL -> APPROVED
  const { data: approvedData, error: approvedError } = await supabase.from('unified_campaigns')
    .update({ status: 'APPROVED', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('owner_id', user.id)
    .eq('status', 'PENDING_APPROVAL')
    .select('channels, status').single();

  if (approvedError || !approvedData) {
    throw new Error('State transition to APPROVED failed (must be in PENDING_APPROVAL state)');
  }

  await logAudit(user.id, 'CAMPAIGN_APPROVED', 'campaign', campaignId, null, null, 'Campaign approved explicitly by owner');

  // Safely create independent deployments idempotently
  if (approvedData.channels) {
    for (const provider of approvedData.channels) {
      try {
        await supabase.from('channel_deployments').insert({
          campaign_id: campaignId,
          owner_id: user.id,
          provider: provider.toLowerCase(),
          status: 'PENDING'
        });
      } catch (e) {
         // Silently catch duplicate insertion errors due to unique constraints for idempotency
      }
    }
  }

  // Final transition: APPROVED -> READY_TO_DEPLOY
  const { error: readyError } = await supabase.from('unified_campaigns')
    .update({ status: 'READY_TO_DEPLOY', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('owner_id', user.id)
    .eq('status', 'APPROVED');

  if (readyError) throw new Error('State transition to READY_TO_DEPLOY failed');

  await logAudit(user.id, 'CAMPAIGN_STATE_CHANGED', 'campaign', campaignId, null, null, 'APPROVED -> READY_TO_DEPLOY');
  revalidatePath('/campaigns');
  revalidatePath(`/campaigns/${campaignId}`);
  return true;
}
