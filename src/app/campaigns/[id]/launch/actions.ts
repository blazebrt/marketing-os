'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { logAudit } from '@/lib/audit';
import { AppError, ERROR_CODES, logSafeError, toSafeError } from '@/lib/errors';
import { normaliseGoogleCampaignId } from '@/lib/campaigns/launchSheet';

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // No Next store outside a request (unit tests).
  }
}

/**
 * Records the Google campaign id the owner created by hand, and marks the
 * campaign LIVE.
 *
 * This writes nothing to Google. It only tells this app which Google campaign
 * to read reporting for. One-click launch stays disabled behind the mutation
 * gate, which this path does not touch.
 */
export async function recordGoogleCampaignId(campaignId: string, rawGoogleId: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);

    const googleCampaignId = normaliseGoogleCampaignId(rawGoogleId);
    if (!googleCampaignId) {
      return { ok: false as const, code: ERROR_CODES.VALIDATION_FAILED };
    }

    const { data: campaign } = await supabase
      .from('unified_campaigns')
      .select('id, owner_id, status')
      .eq('id', campaignId)
      .eq('owner_id', user.id)
      .single();

    if (!campaign) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);

    // Only an approved campaign can be marked live. LIVE is allowed too, so a
    // mistyped id can be corrected.
    if (campaign.status !== 'READY_TO_DEPLOY' && campaign.status !== 'LIVE') {
      return { ok: false as const, code: ERROR_CODES.APPROVAL_FAILED };
    }

    const { data: deployment } = await supabase
      .from('channel_deployments')
      .select('id, external_campaign_id')
      .eq('campaign_id', campaignId)
      .eq('owner_id', user.id)
      .eq('provider', 'google')
      .single();

    if (!deployment) {
      return { ok: false as const, code: ERROR_CODES.APPROVAL_FAILED };
    }

    const { error: depError } = await supabase
      .from('channel_deployments')
      .update({
        external_campaign_id: googleCampaignId,
        status: 'ACTIVE',
        updated_at: new Date().toISOString(),
      })
      .eq('id', deployment.id)
      .eq('owner_id', user.id);

    if (depError) {
      logSafeError('recordGoogleCampaignId.deployment', depError);
      throw new AppError(ERROR_CODES.GENERATION_FAILED, 500);
    }

    const { error: campError } = await supabase
      .from('unified_campaigns')
      .update({ status: 'LIVE', updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('owner_id', user.id);

    if (campError) {
      logSafeError('recordGoogleCampaignId.campaign', campError);
      throw new AppError(ERROR_CODES.GENERATION_FAILED, 500);
    }

    await logAudit(
      user.id,
      deployment.external_campaign_id ? 'GOOGLE_CAMPAIGN_ID_UPDATED' : 'GOOGLE_CAMPAIGN_ID_RECORDED',
      'channel_deployment',
      deployment.id,
      null,
      { google_campaign_id: googleCampaignId },
      'Campaign created manually in Google Ads and marked live'
    );

    safeRevalidate(`/campaigns/${campaignId}`);
    safeRevalidate(`/campaigns/${campaignId}/launch`);
    safeRevalidate('/performance');
    safeRevalidate('/');

    return { ok: true as const, googleCampaignId };
  } catch (err) {
    logSafeError('recordGoogleCampaignId', err);
    return { ok: false as const, code: toSafeError(err).code };
  }
}
