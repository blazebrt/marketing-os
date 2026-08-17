'use server'

import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';
import { redirect } from 'next/navigation';

export async function createPendingCampaign(data: any) {
  const supabase = await createClient();

  // Validate user (only owner should launch)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  // Derived Safe Limits (internal logic hidden from owner)
  // Owner just enters "budget", we decide internally how to safely deploy it.
  const isDaily = data.budgetType === 'daily';
  const amount = parseFloat(data.budget);
  
  const maxCampaignSpend = isDaily ? amount * parseInt(data.duration) : amount;
  const maxAutoIncrease = amount * 0.2; // Max 20% auto increase buffer

  const campaignInsert = {
    service: data.service,
    offer: data.offer,
    status: 'pending_approval',
    budget_type: data.budgetType,
    budget_amount: amount,
    max_daily_spend: isDaily ? amount : amount / parseInt(data.duration),
    max_campaign_spend: maxCampaignSpend,
    max_auto_budget_increase: maxAutoIncrease,
    // Add simple duration offset
    start_at: new Date().toISOString(),
    end_at: new Date(Date.now() + parseInt(data.duration) * 24 * 60 * 60 * 1000).toISOString(),
  };

  const { data: campaign, error: campError } = await supabase
    .from('unified_campaigns')
    .insert(campaignInsert)
    .select('id')
    .single();

  if (campError) throw new Error('Failed to create campaign');

  // Insert Channel Deployments
  const channels = data.channels || [];
  
  if (channels.includes('meta')) {
    const { data: deployment } = await supabase.from('channel_deployments').insert({
      unified_campaign_id: campaign.id,
      channel: 'meta',
      channel_specific_allocation: channels.length === 2 ? amount / 2 : amount,
      status: 'pending'
    }).select('id').single();

    if (deployment) {
      await supabase.from('creatives_meta').insert({
        channel_deployment_id: deployment.id,
        media_url: data.metaCreativeUrl || 'placeholder',
        format: 'image'
      });
    }
  }

  if (channels.includes('google')) {
    const { data: deployment } = await supabase.from('channel_deployments').insert({
      unified_campaign_id: campaign.id,
      channel: 'google',
      channel_specific_allocation: channels.length === 2 ? amount / 2 : amount,
      status: 'pending'
    }).select('id').single();

    if (deployment) {
      // Owner doesn't manually configure exact keywords yet, AI placeholder structure
      await supabase.from('creatives_google').insert({
        channel_deployment_id: deployment.id,
        headlines: JSON.stringify([data.offer, data.service]),
        descriptions: JSON.stringify([`Book your ${data.service} today and get ${data.offer}`]),
        keywords: JSON.stringify([
          { keyword: data.service, match_type: 'exact', ai_generated: true, owner_approved: true }
        ])
      });
    }
  }

  await logAudit('owner', 'CREATE_CAMPAIGN', 'unified_campaign', campaign.id, null, campaignInsert, 'Wizard submission');
  
  redirect('/');
}
