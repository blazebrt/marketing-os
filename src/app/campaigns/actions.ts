'use server';

import { createClient } from '@/lib/supabase/server';
import { CampaignIntentSchema } from '@/lib/schemas/campaigns';
import { calculateSafetyLimits } from '@/lib/campaigns/safeguards';
import { logAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { googleCreativeApprovalErrors } from '@/lib/providers/google/validation';
import { googleAdsDestinationRejection, parseDestinationType } from '@/lib/campaigns/destination';
import { validateDestinationUrl, validateDestinationUrlSyntax } from '@/lib/urlValidator';
import { AppError, ERROR_CODES, logSafeError, toSafeError } from '@/lib/errors';

export async function saveDraftCampaign(payload: unknown) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);

  const parsed = CampaignIntentSchema.parse(payload);
  const limits = calculateSafetyLimits(parsed.budget_type, parsed.budget_amount, parsed.duration_days);
  const destinationType = parsed.destination_type;
  const landingUrl = destinationType === 'WEBSITE' ? (parsed.landing_url || '').trim() : null;

  if (destinationType === 'WEBSITE') {
    const syntax = validateDestinationUrlSyntax(landingUrl || '');
    if (!syntax.valid) throw new AppError(ERROR_CODES.DESTINATION_INVALID, 400);
  }

  const { data, error } = await supabase.from('unified_campaigns').insert({
    owner_id: user.id,
    service: parsed.service,
    offer: parsed.offer,
    budget_type: parsed.budget_type,
    budget_amount: parsed.budget_amount,
    duration_days: parsed.duration_days,
    max_daily_spend: limits.maxDaily,
    max_campaign_spend: limits.maxTotal,
    destination: destinationType,
    destination_type: destinationType,
    landing_url: landingUrl,
    channels: parsed.channels,
    creative_id: null,
    status: 'DRAFT',
  }).select('id').single();

  if (error || !data) throw new AppError(ERROR_CODES.GENERATION_FAILED, 500);

  await logAudit(user.id, 'CAMPAIGN_CREATED', 'campaign', data.id, null, null, 'Draft campaign created via wizard');
  return data.id;
}

export async function verifyCampaign(campaignId: string, options?: { checkReachability?: boolean }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);

  const { data: campaign } = await supabase
    .from('unified_campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('owner_id', user.id)
    .single();
  if (!campaign) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);

  const checks: { name: string; pass: boolean; message: string }[] = [];

  try {
    calculateSafetyLimits(campaign.budget_type, Number(campaign.budget_amount), campaign.duration_days);
    checks.push({ name: 'Budget & Duration', pass: true, message: 'Budget and duration are within configured safety bounds' });
  } catch {
    checks.push({ name: 'Budget & Duration', pass: false, message: 'Budget or duration is invalid' });
  }

  if (!campaign.creative_id) {
    checks.push({ name: 'Creative', pass: false, message: 'No creative attached' });
  } else {
    const { data: cr } = await supabase
      .from('creatives')
      .select('id, campaign_id, owner_id, status')
      .eq('id', campaign.creative_id)
      .eq('owner_id', user.id)
      .single();
    if (!cr || cr.campaign_id !== campaignId) {
      checks.push({ name: 'Creative', pass: false, message: 'Creative record not found or inaccessible' });
    } else {
      const { data: cg } = await supabase.from('creatives_google').select('*').eq('creative_id', campaign.creative_id).eq('owner_id', user.id).single();
      if (!cg) {
        checks.push({ name: 'Creative Content', pass: false, message: 'Google creative content missing' });
      } else {
        const errors = googleCreativeApprovalErrors(cg);
        if (errors.length === 0) {
          checks.push({ name: 'Creative', pass: true, message: 'All required creative components are approved' });
        } else {
          checks.push({ name: 'Creative', pass: false, message: 'Creative is not fully approved' });
        }
      }
    }
  }

  const destType = parseDestinationType(campaign.destination_type) || parseDestinationType(campaign.destination);
  const googleReject = googleAdsDestinationRejection(destType, campaign.channels || []);
  if (googleReject) {
    checks.push({ name: 'Destination', pass: false, message: 'Google Ads requires a website landing URL' });
  } else if (destType === 'WEBSITE') {
    const landing = campaign.landing_url || '';
    const syntax = validateDestinationUrlSyntax(landing);
    if (!syntax.valid) {
      checks.push({ name: 'Destination', pass: false, message: 'Landing URL must be a public HTTPS URL' });
    } else if (options?.checkReachability) {
      const urlCheck = await validateDestinationUrl(landing);
      if (urlCheck.valid) {
        await supabase.from('unified_campaigns').update({
          destination_verified_at: new Date().toISOString(),
          destination_verification_status: 'VALID',
          destination_verification_error: null,
        }).eq('id', campaignId).eq('owner_id', user.id);
        checks.push({ name: 'Destination', pass: true, message: 'Destination URL verified' });
      } else {
        await supabase.from('unified_campaigns').update({
          destination_verified_at: new Date().toISOString(),
          destination_verification_status: 'INVALID',
          destination_verification_error: urlCheck.code || 'DESTINATION_INVALID',
        }).eq('id', campaignId).eq('owner_id', user.id);
        checks.push({ name: 'Destination', pass: false, message: urlCheck.code === 'DESTINATION_UNREACHABLE' ? 'Destination unreachable' : 'Destination invalid' });
      }
    } else if (campaign.destination_verification_status === 'VALID') {
      checks.push({ name: 'Destination', pass: true, message: 'Destination previously verified' });
    } else {
      checks.push({ name: 'Destination', pass: false, message: 'Run destination verification before approval' });
    }
  } else if (destType === 'WHATSAPP' || destType === 'PHONE') {
    checks.push({ name: 'Destination', pass: true, message: `${destType} destination does not use a web landing URL` });
  } else {
    checks.push({ name: 'Destination', pass: false, message: 'Missing destination' });
  }

  const { data: creds } = await supabase.from('integrations').select('provider').eq('owner_id', user.id).eq('status', 'connected');
  const connectedProviders = creds?.map((c: { provider: string }) => c.provider.toLowerCase()) || [];

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

  if (destType === 'WEBSITE' && connectedProviders.includes('website')) {
    checks.push({ name: 'Tracking Readiness', pass: true, message: 'Website tracking integration is active' });
  } else if (destType === 'WEBSITE') {
    checks.push({ name: 'Tracking Readiness', pass: true, message: 'No explicit tracking setup required for this destination' });
  } else {
    checks.push({ name: 'Tracking Readiness', pass: true, message: 'No explicit tracking setup required for this destination' });
  }

  const allPass = checks.every((c) => c.pass);
  await logAudit(user.id, 'PRELAUNCH_VERIFICATION', 'campaign', campaignId, null, null, `Verification ${allPass ? 'Passed' : 'Failed'}`);

  return { checks, allPass };
}

export async function requestApproval(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);

  const verification = await verifyCampaign(campaignId, { checkReachability: true });
  if (!verification.allPass) {
    throw new AppError(ERROR_CODES.APPROVAL_FAILED, 400);
  }

  const { error, data } = await supabase.from('unified_campaigns')
    .update({ status: 'PENDING_APPROVAL', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('owner_id', user.id)
    .eq('status', 'DRAFT')
    .select('id').single();

  if (error || !data) throw new AppError(ERROR_CODES.APPROVAL_FAILED, 400);

  await logAudit(user.id, 'CAMPAIGN_SUBMITTED_FOR_APPROVAL', 'campaign', campaignId, null, null, 'DRAFT -> PENDING_APPROVAL');
  revalidatePath('/campaigns');
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function approveCampaign(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);

  const { data, error } = await supabase.rpc('rpc_approve_campaign', {
    p_campaign_id: campaignId,
    p_owner_id: user.id,
  });

  if (error || !data?.success) {
    logSafeError('approveCampaign', error);
    throw new AppError(ERROR_CODES.APPROVAL_FAILED, 400);
  }

  revalidatePath('/campaigns');
  revalidatePath(`/campaigns/${campaignId}`);
  return true;
}

export async function generateCreativesAction(campaignId: string) {
  const { generateAndSaveGoogleCreatives } = await import('@/lib/providers/google/generative');
  try {
    const result = await generateAndSaveGoogleCreatives(campaignId);
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath(`/campaigns/${campaignId}/google`);
    return { ok: true as const, creativeId: result.creativeId };
  } catch (err) {
    logSafeError('generateCreativesAction', err);
    const safe = toSafeError(err);
    return { ok: false as const, code: safe.code };
  }
}

export async function verifyDestinationAction(campaignId: string) {
  try {
    const result = await verifyCampaign(campaignId, { checkReachability: true });
    revalidatePath(`/campaigns/${campaignId}`);
    return { ok: result.allPass, checks: result.checks };
  } catch (err) {
    logSafeError('verifyDestinationAction', err);
    return { ok: false, checks: [], code: toSafeError(err).code };
  }
}
