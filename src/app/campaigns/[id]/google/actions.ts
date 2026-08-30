'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { GoogleCreativeItem } from '@/lib/providers/google/types';
import {
  CreativeItemType,
  isCreativeItemType,
  validateDescription,
  validateHeadline,
  validateKeyword,
  validateStoredItems,
  googleCreativeApprovalErrors,
} from '@/lib/providers/google/validation';
import { AppError, ERROR_CODES, logSafeError, toSafeError } from '@/lib/errors';
import { deployGoogleCampaign } from '@/lib/providers/google/deployment';
import { reconcileGoogleDeployment } from '@/lib/providers/google/reconciliation';
import { googleAdsDestinationRejection, parseDestinationType } from '@/lib/campaigns/destination';
import { regenerateSingleItem } from '@/lib/providers/google/generative';
import { isUuid } from '@/lib/ids';

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Non-request contexts (unit tests) have no Next static generation store.
  }
}

function itemValidator(itemType: CreativeItemType) {
  if (itemType === 'headlines') return validateHeadline;
  if (itemType === 'descriptions') return validateDescription;
  return validateKeyword;
}

function deriveCreativeStatus(google: {
  headlines?: GoogleCreativeItem[];
  descriptions?: GoogleCreativeItem[];
  keywords?: GoogleCreativeItem[];
}): string {
  const errors = googleCreativeApprovalErrors(google);
  if (errors.length === 0) return 'APPROVED';
  const anyApproved = ['headlines', 'descriptions', 'keywords'].some((k) =>
    ((google as any)[k] || []).some((i: GoogleCreativeItem) => i.owner_approved === true)
  );
  if (anyApproved) return 'PARTIALLY_REVIEWED';
  return 'GENERATED';
}

export async function updateGoogleCreativeItem(
  campaignId: string,
  creativeId: string,
  itemType: string,
  itemId: string,
  action: 'approve' | 'reject' | 'edit' | 'regenerate' | 'replace',
  newValue?: string
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);

  if (!isUuid(campaignId) || !isUuid(creativeId) || !isUuid(itemId)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400);
  }

  if (!isCreativeItemType(itemType)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400);
  }

  const { data: campaign } = await supabase
    .from('unified_campaigns')
    .select('id, owner_id, creative_id, status')
    .eq('id', campaignId)
    .eq('owner_id', user.id)
    .single();

  if (!campaign || campaign.owner_id !== user.id) {
    throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);
  }
  if (campaign.creative_id !== creativeId) {
    throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);
  }
  if (campaign.status === 'READY_TO_DEPLOY' || campaign.status === 'ACTIVE' || campaign.status === 'LIVE') {
    throw new AppError(ERROR_CODES.CREATIVE_LOCKED, 409);
  }

  const { data: creative } = await supabase
    .from('creatives')
    .select('id, owner_id, campaign_id, status')
    .eq('id', creativeId)
    .eq('owner_id', user.id)
    .single();

  if (!creative || creative.campaign_id !== campaignId) {
    throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);
  }

  const { data: creativeGoogle } = await supabase
    .from('creatives_google')
    .select('*')
    .eq('creative_id', creativeId)
    .eq('owner_id', user.id)
    .single();

  if (!creativeGoogle) {
    throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);
  }

  const items: GoogleCreativeItem[] = Array.isArray(creativeGoogle[itemType]) ? [...creativeGoogle[itemType]] : [];
  const itemIndex = items.findIndex((i) => i.id === itemId);
  if (itemIndex === -1) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400);
  }

  const item = { ...items[itemIndex] };
  const expectedVersion = creativeGoogle.item_version ?? 1;

  if (action === 'approve') {
    item.owner_approved = true;
    item.rejected = false;
    item.approved_at = new Date().toISOString();
  } else if (action === 'reject') {
    item.owner_approved = false;
    item.rejected = true;
    item.approved_at = new Date().toISOString();
  } else if (action === 'regenerate') {
    // Local reset: restore this rejected item to its original AI wording.
    // Asking the model for NEW wording is regenerateGoogleCreativeItem below.
    if (item.owner_approved === true) {
      throw new AppError(ERROR_CODES.CREATIVE_LOCKED, 409);
    }
    if (!item.rejected) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400);
    }
    const next = `${item.original_value}`.substring(0, itemType === 'descriptions' ? 90 : itemType === 'headlines' ? 30 : 80);
    item.current_value = next;
    item.owner_approved = false;
    item.rejected = false;
    item.approved_at = null;
  } else if (action === 'edit' || action === 'replace') {
    if (!newValue || newValue.trim() === '') throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400);
    const tempItem: GoogleCreativeItem = { ...item, current_value: newValue };
    const errors = itemValidator(itemType)(tempItem);
    if (errors.length > 0) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400);

    if (item.owner_approved === true && action === 'edit') {
      throw new AppError(ERROR_CODES.CREATIVE_LOCKED, 409);
    }

    item.current_value = newValue;
    item.owner_approved = false;
    item.rejected = false;
    item.approved_at = null;
  } else {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400);
  }

  items[itemIndex] = item;
  const uniqueness = validateStoredItems(items, itemType);
  if (!uniqueness.valid) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400);

  const nextGoogle = {
    ...creativeGoogle,
    [itemType]: items,
  };
  const nextStatus = deriveCreativeStatus(nextGoogle);

  const { data: updated, error } = await supabase
    .from('creatives_google')
    .update({ [itemType]: items, item_version: expectedVersion + 1 })
    .eq('creative_id', creativeId)
    .eq('owner_id', user.id)
    .eq('item_version', expectedVersion)
    .select('creative_id');

  if (error) {
    logSafeError('updateGoogleCreativeItem', error);
    throw new AppError(ERROR_CODES.GENERATION_FAILED, 500);
  }
  if (!updated || updated.length === 0) {
    throw new AppError(ERROR_CODES.CONFLICT, 409);
  }

  await supabase
    .from('creatives')
    .update({ status: nextStatus })
    .eq('id', creativeId)
    .eq('owner_id', user.id);

  const actionName =
    action === 'approve'
      ? 'GOOGLE_CREATIVE_APPROVED'
      : action === 'reject'
        ? 'GOOGLE_CREATIVE_REJECTED'
        : action === 'regenerate'
          ? 'GOOGLE_CREATIVE_RESTORED'
          : 'GOOGLE_CREATIVE_REPLACED';

  await supabase.from('audit_logs').insert({
    owner_id: user.id,
    action: actionName,
    resource_type: 'creative_google',
    resource_id: creativeId,
    details: { itemType, itemId },
  });

  safeRevalidate(`/campaigns/${campaignId}/google`);
  return { success: true };
}

export async function deployToTestAccount(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);
  if (!isUuid(campaignId)) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400);

  const { data: campaign } = await supabase
    .from('unified_campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('owner_id', user.id)
    .single();
  if (!campaign) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);

  const destType = parseDestinationType(campaign.destination_type);
  if (googleAdsDestinationRejection(destType, campaign.channels || [])) {
    throw new AppError(ERROR_CODES.APPROVAL_FAILED, 400);
  }

  const { data: deployment } = await supabase
    .from('channel_deployments')
    .select('status, target_state')
    .eq('campaign_id', campaignId)
    .eq('provider', 'google')
    .eq('owner_id', user.id)
    .single();

  if (!deployment || deployment.status !== 'READY_TO_DEPLOY' || !deployment.target_state?.headlines) {
    throw new AppError(ERROR_CODES.APPROVAL_FAILED, 400);
  }

  await deployGoogleCampaign(campaignId, user.id);
  safeRevalidate(`/campaigns/${campaignId}/google`);
  return { success: true };
}

export async function reconcileDeployment(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);
  if (!isUuid(campaignId)) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400);

  const result = await reconcileGoogleDeployment(campaignId, user.id);
  safeRevalidate(`/campaigns/${campaignId}/google`);
  return result;
}

/**
 * Asks the model for a fresh suggestion for one item. Goes through the same
 * generation lock and rate limiter as a full generation. Returns a result
 * object rather than throwing, so the review screen can show a clear message.
 */
export async function regenerateGoogleCreativeItem(
  campaignId: string,
  itemType: string,
  itemId: string
) {
  if (!isUuid(campaignId) || !isUuid(itemId) || !isCreativeItemType(itemType)) {
    return { ok: false as const, code: ERROR_CODES.VALIDATION_FAILED };
  }
  try {
    const result = await regenerateSingleItem(campaignId, itemType, itemId);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('audit_logs').insert({
        owner_id: user.id,
        action: 'GOOGLE_CREATIVE_REGENERATED',
        resource_type: 'creative_google',
        resource_id: result.creativeId,
        details: { itemType, itemId },
      });
    }

    safeRevalidate(`/campaigns/${campaignId}/google`);
    return { ok: true as const };
  } catch (err) {
    logSafeError('regenerateGoogleCreativeItem', err);
    return { ok: false as const, code: toSafeError(err).code };
  }
}
