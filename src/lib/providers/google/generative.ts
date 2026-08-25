import { createClient } from '@/lib/supabase/server';
import { v4 as uuidv4 } from 'uuid';
import { GoogleCreativeItem } from './types';
import { validateCreativePayload } from './validation';
import { AppError, ERROR_CODES, logSafeError } from '@/lib/errors';
import { LLM_PRIVACY } from '@/lib/privacy/llm';

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

function mockGeneratePayload(service: string, offer: string) {
  // Local mock only. See LLM_PRIVACY — no provider call, no secrets.
  void LLM_PRIVACY;
  return {
    headlines: [
      `Buy ${service}`.substring(0, 30),
      `${offer} offer`.substring(0, 30),
      `Get ${service} today`.substring(0, 30),
    ],
    descriptions: [
      `Sign up for ${service} and get ${offer} now.`.substring(0, 90),
      `Best ${service} with ${offer} guaranteed.`.substring(0, 90),
    ],
    keywords: [`${service}`.substring(0, 80), `${service} deal`.substring(0, 80)],
  };
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

  const payload = mockGeneratePayload(String(campaign.service || ''), String(campaign.offer || ''));
  const validation = validateCreativePayload(payload);
  if (!validation.valid) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400);
  }

  const headlines = convertToCreativeItems(payload.headlines);
  const descriptions = convertToCreativeItems(payload.descriptions);
  const keywords = convertToCreativeItems(payload.keywords, 'EXACT');
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
