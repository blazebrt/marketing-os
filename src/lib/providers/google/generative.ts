import { createClient } from '@/lib/supabase/server';
import { v4 as uuidv4 } from 'uuid';
import { GoogleCreativeItem } from './types';
import {
  validateCreativePayload,
  validateStoredItems,
  normalizeCreativeText,
  type CreativeItemType,
} from './validation';
import { AppError, ERROR_CODES, logSafeError } from '@/lib/errors';
import { buildLlmCampaignContext } from '@/lib/privacy/llm';
import { generateAdCopy, type CreativeStrategy } from '@/lib/llm/gemini';
import { repairAdCopy, meetsTargetCounts, describeShortfalls, type RepairedAdCopy } from './copyRepair';

function convertToCreativeItems(strings: string[], matchType?: 'EXACT' | 'PHRASE'): GoogleCreativeItem[] {
  return strings.map((s) => ({
    id: uuidv4(),
    original_value: s,
    current_value: s,
    ai_generated: true,
    owner_approved: null,
    rejected: false,
    match_type: matchType,
  }));
}

const MAX_GENERATION_ATTEMPTS = 3;

/**
 * The owner-approved strategy this campaign came from, if any.
 *
 * Campaigns created by hand have no plan, and generation falls back to the
 * campaign's own fields -- exactly as before. Nothing here can fail the
 * generation; a missing plan simply means no angles.
 */
async function loadCampaignStrategy(
  supabase: Awaited<ReturnType<typeof createClient>>,
  campaignId: string,
  ownerId: string
): Promise<CreativeStrategy | undefined> {
  try {
    const { data } = await supabase
      .from('marketing_plans')
      .select('plan')
      .eq('campaign_id', campaignId)
      .eq('owner_id', ownerId)
      .eq('status', 'CONVERTED')
      .order('approved_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const plan = data?.plan as
      | { messaging_strategy?: unknown; creative_angles?: unknown }
      | undefined;
    if (!plan) return undefined;

    const angles = Array.isArray(plan.creative_angles)
      ? (plan.creative_angles as { name?: unknown; description?: unknown }[])
          .filter((a) => typeof a?.name === 'string' && typeof a?.description === 'string')
          .map((a) => ({ name: String(a.name), description: String(a.description) }))
      : [];

    if (angles.length === 0) return undefined;
    return {
      messaging: typeof plan.messaging_strategy === 'string' ? plan.messaging_strategy : '',
      angles,
    };
  } catch {
    return undefined;
  }
}

/**
 * Asks the model for ad copy, repairs what it returns, and only accepts a set
 * that passes the unchanged validation in validation.ts. Falls back to nothing:
 * if every attempt fails validation the caller gets an error and no creative is
 * written, so an invalid creative can never reach the database.
 */
async function generateValidatedCopy(
  campaign: Record<string, unknown>,
  strategy?: CreativeStrategy
): Promise<RepairedAdCopy> {
  // Only the allow-listed campaign description fields leave the app.
  const context = buildLlmCampaignContext(campaign);

  let feedback: string[] | undefined;
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const raw = await generateAdCopy(context, feedback, strategy);
    const repaired = repairAdCopy(raw);

    const validation = validateCreativePayload({
      headlines: repaired.headlines,
      descriptions: repaired.descriptions,
      keywords: repaired.keywords.map((k) => k.text),
    });

    const shortfalls = describeShortfalls(repaired);

    if (validation.valid && (meetsTargetCounts(repaired) || attempt === MAX_GENERATION_ATTEMPTS)) {
      return repaired;
    }

    lastErrors = validation.valid ? shortfalls : validation.errors;
    feedback = lastErrors.slice(0, 10);
  }

  logSafeError('generateValidatedCopy', new Error(`VALIDATION_FAILED: ${lastErrors.length} unresolved`));
  throw new AppError(ERROR_CODES.LLM_INVALID_OUTPUT, 502);
}

/**
 * Generate Google RSA copy. Identity is always derived from the session.
 * ownerId is never accepted as an authority parameter.
 */
export async function generateAndSaveGoogleCreatives(campaignId: string) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);
  }
  const ownerId = authData.user.id;

  const { data: lock, error: lockErr } = await supabase.rpc('rpc_acquire_generation_lock', {
    p_campaign_id: campaignId,
  });
  if (lockErr || !lock?.success) {
    const msg = lockErr?.message || '';
    if (msg.includes('RATE_LIMITED')) throw new AppError(ERROR_CODES.RATE_LIMITED, 429);
    if (msg.includes('CREATIVE_LOCKED')) throw new AppError(ERROR_CODES.CREATIVE_LOCKED, 409);
    if (msg.includes('UNAUTHORIZED')) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);
    throw new AppError(ERROR_CODES.GENERATION_FAILED, 500);
  }

  const { data: campaign, error: cErr } = await supabase
    .from('unified_campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('owner_id', ownerId)
    .single();

  if (cErr || !campaign) {
    throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);
  }

  if (campaign.creative_id) {
    const { data: existing } = await supabase
      .from('creatives')
      .select('status, campaign_id, owner_id')
      .eq('id', campaign.creative_id)
      .eq('owner_id', ownerId)
      .single();

    if (!existing || existing.campaign_id !== campaignId) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);
    }
    if (existing.status === 'APPROVED') {
      throw new AppError(ERROR_CODES.CREATIVE_LOCKED, 409);
    }
  }

  const strategy = await loadCampaignStrategy(supabase, campaignId, ownerId);
  const copy = await generateValidatedCopy(campaign, strategy);

  const headlines = convertToCreativeItems(copy.headlines);
  const descriptions = convertToCreativeItems(copy.descriptions);
  const keywords = copy.keywords.map((k) => ({
    id: uuidv4(),
    original_value: k.text,
    current_value: k.text,
    ai_generated: true,
    owner_approved: null,
    rejected: false,
    match_type: k.match_type,
  }));
  const creativeId = campaign.creative_id || uuidv4();

  try {
    if (!campaign.creative_id) {
      const { error: insErr } = await supabase.from('creatives').insert({
        id: creativeId,
        owner_id: ownerId,
        campaign_id: campaignId,
        name: campaign.service,
        type: 'google_rsa',
        status: 'GENERATED',
        version: 1,
        generation_lock_until: null,
      });
      if (insErr) throw insErr;

      const { error: gErr } = await supabase.from('creatives_google').insert({
        creative_id: creativeId,
        owner_id: ownerId,
        headlines,
        descriptions,
        keywords,
        generation_status: 'GENERATED',
        last_generated_at: new Date().toISOString(),
      });
      if (gErr) throw gErr;

      const { error: linkErr } = await supabase
        .from('unified_campaigns')
        .update({ creative_id: creativeId })
        .eq('id', campaignId)
        .eq('owner_id', ownerId);
      if (linkErr) throw linkErr;
    } else {
      const { data: existingGoogle } = await supabase
        .from('creatives_google')
        .select('headlines, descriptions, keywords')
        .eq('creative_id', creativeId)
        .eq('owner_id', ownerId)
        .single();

      const locked =
        existingGoogle &&
        [...(existingGoogle.headlines || []), ...(existingGoogle.descriptions || []), ...(existingGoogle.keywords || [])].some(
          (i: GoogleCreativeItem) => i.owner_approved === true
        );
      if (locked) throw new AppError(ERROR_CODES.CREATIVE_LOCKED, 409);

      const { error: uErr } = await supabase
        .from('creatives_google')
        .update({
          headlines,
          descriptions,
          keywords,
          generation_status: 'GENERATED',
          last_generated_at: new Date().toISOString(),
        })
        .eq('creative_id', creativeId)
        .eq('owner_id', ownerId);
      if (uErr) throw uErr;

    await supabase
        .from('creatives')
        .update({ status: 'GENERATED', generation_lock_until: null })
        .eq('id', creativeId)
        .eq('owner_id', ownerId)
        .neq('status', 'APPROVED');
    }

    return { creativeId };
  } catch (err) {
    logSafeError('generateAndSaveGoogleCreatives', err);
    if (err instanceof AppError) throw err;
    throw new AppError(ERROR_CODES.GENERATION_FAILED, 500);
  }
}

/**
 * Regenerates a single item with a fresh suggestion from the model.
 *
 * Goes through the same generation lock and rate limiter as a full generation,
 * and produces a suggestion that is unapproved like any other generated copy.
 * Approved items are never overwritten.
 */
export async function regenerateSingleItem(
  campaignId: string,
  itemType: CreativeItemType,
  itemId: string
): Promise<{ creativeId: string; value: string }> {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);
  }
  const ownerId = authData.user.id;

  const { data: campaign, error: cErr } = await supabase
    .from('unified_campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('owner_id', ownerId)
    .single();
  if (cErr || !campaign || !campaign.creative_id) {
    throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);
  }
  if (campaign.status === 'READY_TO_DEPLOY' || campaign.status === 'ACTIVE' || campaign.status === 'LIVE') {
    throw new AppError(ERROR_CODES.CREATIVE_LOCKED, 409);
  }

  const creativeId = campaign.creative_id as string;

  const { data: creativeGoogle } = await supabase
    .from('creatives_google')
    .select('*')
    .eq('creative_id', creativeId)
    .eq('owner_id', ownerId)
    .single();
  if (!creativeGoogle) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);

  const items: GoogleCreativeItem[] = Array.isArray(creativeGoogle[itemType]) ? [...creativeGoogle[itemType]] : [];
  const index = items.findIndex((i) => i.id === itemId);
  if (index === -1) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400);
  if (items[index].owner_approved === true) throw new AppError(ERROR_CODES.CREATIVE_LOCKED, 409);

  // Same lock and rate limiter as a full generation.
  const { data: lock, error: lockErr } = await supabase.rpc('rpc_acquire_generation_lock', {
    p_campaign_id: campaignId,
  });
  if (lockErr || !lock?.success) {
    const msg = lockErr?.message || '';
    if (msg.includes('RATE_LIMITED')) throw new AppError(ERROR_CODES.RATE_LIMITED, 429);
    if (msg.includes('CREATIVE_LOCKED')) throw new AppError(ERROR_CODES.CREATIVE_LOCKED, 409);
    if (msg.includes('UNAUTHORIZED')) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);
    throw new AppError(ERROR_CODES.GENERATION_FAILED, 500);
  }

  const strategy = await loadCampaignStrategy(supabase, campaignId, ownerId);
  const copy = await generateValidatedCopy(campaign, strategy);

  // Take the first suggestion that is not already used by another item.
  const taken = new Set(
    items.filter((_, i) => i !== index).map((i) => normalizeCreativeText(i.current_value))
  );
  const candidates =
    itemType === 'headlines'
      ? copy.headlines.map((text) => ({ text, match_type: undefined as 'EXACT' | 'PHRASE' | undefined }))
      : itemType === 'descriptions'
        ? copy.descriptions.map((text) => ({ text, match_type: undefined as 'EXACT' | 'PHRASE' | undefined }))
        : copy.keywords.map((k) => ({ text: k.text, match_type: k.match_type as 'EXACT' | 'PHRASE' | undefined }));

  const chosen = candidates.find((c) => !taken.has(normalizeCreativeText(c.text)));
  if (!chosen) throw new AppError(ERROR_CODES.LLM_INVALID_OUTPUT, 502);

  items[index] = {
    ...items[index],
    original_value: chosen.text,
    current_value: chosen.text,
    ai_generated: true,
    owner_approved: null,
    rejected: false,
    approved_at: null,
    match_type: itemType === 'keywords' ? chosen.match_type : items[index].match_type,
  };

  // The whole list must still be valid before anything is written.
  const stored = validateStoredItems(items, itemType);
  if (!stored.valid) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400);

  const expectedVersion = creativeGoogle.item_version ?? 1;
  const { data: updated, error: uErr } = await supabase
    .from('creatives_google')
    .update({ [itemType]: items, item_version: expectedVersion + 1, last_generated_at: new Date().toISOString() })
    .eq('creative_id', creativeId)
    .eq('owner_id', ownerId)
    .eq('item_version', expectedVersion)
    .select('creative_id');

  if (uErr) {
    logSafeError('regenerateSingleItem', uErr);
    throw new AppError(ERROR_CODES.GENERATION_FAILED, 500);
  }
  if (!updated || updated.length === 0) throw new AppError(ERROR_CODES.CONFLICT, 409);

  await supabase
    .from('creatives')
    .update({ status: 'GENERATED', generation_lock_until: null })
    .eq('id', creativeId)
    .eq('owner_id', ownerId)
    .neq('status', 'APPROVED');

  return { creativeId, value: chosen.text };
}
