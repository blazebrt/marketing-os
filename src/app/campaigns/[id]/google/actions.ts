'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { GoogleCreativeItem } from '@/lib/providers/google/types';

export async function updateGoogleCreativeItem(
  campaignId: string,
  creativeId: string,
  itemType: 'keywords' | 'headlines' | 'descriptions',
  itemId: string,
  action: 'approve' | 'reject' | 'edit',
  newValue?: string
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // Verify campaign ownership
  const { data: campaign } = await supabase
    .from('unified_campaigns')
    .select('owner_id')
    .eq('id', campaignId)
    .single();
  
  if (!campaign || campaign.owner_id !== user.id) {
    throw new Error('Unauthorized campaign');
  }

  // Verify creative ownership
  const { data: creativeGoogle } = await supabase
    .from('creatives_google')
    .select('*')
    .eq('creative_id', creativeId)
    .eq('owner_id', user.id)
    .single();

  if (!creativeGoogle) {
    throw new Error('Unauthorized creative');
  }

  const items: GoogleCreativeItem[] = creativeGoogle[itemType] || [];
  const itemIndex = items.findIndex(i => i.id === itemId);

  if (itemIndex === -1) {
    throw new Error('Item not found');
  }

  const item = items[itemIndex];

  if (action === 'approve') {
    item.owner_approved = true;
    item.rejected = false;
  } else if (action === 'reject') {
    item.owner_approved = false;
    item.rejected = true;
  } else if (action === 'edit') {
    if (!newValue || newValue.trim() === '') throw new Error('Cannot be empty');
    item.current_value = newValue;
    item.owner_approved = true; // Implicitly approved by editing
    item.rejected = false;
  }

  item.approved_at = new Date().toISOString();

  // Save back to db
  const { error } = await supabase
    .from('creatives_google')
    .update({ [itemType]: items })
    .eq('creative_id', creativeId);

  if (error) throw new Error('Failed to update creative: ' + error.message);

  // Audit event
  const actionName = action === 'approve' 
    ? 'GOOGLE_CREATIVE_APPROVED' 
    : action === 'reject' 
      ? 'GOOGLE_CREATIVE_REJECTED' 
      : 'GOOGLE_CREATIVE_EDITED';

  await supabase.from('audit_logs').insert({
    owner_id: user.id,
    action: actionName,
    resource_type: 'creative_google',
    resource_id: creativeId,
    details: { itemType, itemId, newValue }
  });

  revalidatePath(`/campaigns/${campaignId}/google`);
  return { success: true };
}

import { deployGoogleCampaign } from '@/lib/providers/google/deployment';
import { reconcileGoogleDeployment } from '@/lib/providers/google/reconciliation';

export async function deployToTestAccount(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  await deployGoogleCampaign(campaignId, user.id);
  revalidatePath(`/campaigns/${campaignId}/google`);
  return { success: true };
}

export async function reconcileDeployment(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const result = await reconcileGoogleDeployment(campaignId, user.id);
  revalidatePath(`/campaigns/${campaignId}/google`);
  return result;
}
