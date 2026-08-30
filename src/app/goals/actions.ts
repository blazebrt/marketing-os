'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AppError, ERROR_CODES, logSafeError, toSafeError } from '@/lib/errors';
import { loadSalonContext } from '@/lib/salon/context';
import { isSalonReadyForStrategy } from '@/lib/salon/types';
import { loadPerformanceHistory } from '@/lib/strategy/history';
import { generateMarketingPlan } from '@/lib/strategy/generate';
import { MarketingPlanSchema, type MarketingPlan } from '@/lib/strategy/schema';
import { recordAiEvent } from '@/lib/ai/events';
import { saveDraftCampaign } from '@/app/campaigns/actions';
import { logAudit } from '@/lib/audit';

function safeRevalidate(path: string) {
  try { revalidatePath(path); } catch { /* no store outside a request */ }
}

async function requireOwner() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);
  return { supabase, ownerId: user.id };
}

export const GoalInputSchema = z.object({
  goal_type: z.enum([
    'MORE_BOOKINGS', 'MORE_NEW_CUSTOMERS', 'PROMOTE_SERVICE', 'PROMOTE_OFFER',
    'INCREASE_REVENUE', 'FILL_SLOW_DAYS', 'INCREASE_REPEAT_VISITS',
  ]),
  description: z.string().trim().max(500).optional().nullable(),
  target_value: z.number().positive().max(1_000_000).optional().nullable(),
  timeframe_days: z.number().int().min(7).max(365).default(30),
  budget_amount: z.number().positive().max(50_000).optional().nullable(),
});

/**
 * Records what the owner wants, then asks the strategist for a plan.
 *
 * The plan is stored only after it has passed schema validation and the
 * grounding checks, so nothing ungrounded is ever persisted or shown.
 */
export async function createGoalAndPlan(raw: unknown) {
  let ownerIdForEvent: string | null = null;
  try {
    const { supabase, ownerId } = await requireOwner();
    ownerIdForEvent = ownerId;
    const goal = GoalInputSchema.parse(raw);

    const context = await loadSalonContext(ownerId);
    if (!isSalonReadyForStrategy(context)) {
      return { ok: false as const, code: 'SALON_INCOMPLETE' };
    }

    const { data: goalRow, error: goalError } = await supabase
      .from('marketing_goals')
      .insert({
        owner_id: ownerId,
        goal_type: goal.goal_type,
        description: goal.description ?? null,
        target_value: goal.target_value ?? null,
        timeframe_days: goal.timeframe_days,
        budget_amount: goal.budget_amount ?? null,
      })
      .select('id')
      .single();

    if (goalError || !goalRow) {
      logSafeError('createGoalAndPlan.goal', goalError);
      throw new AppError(ERROR_CODES.GENERATION_FAILED, 500);
    }

    const history = await loadPerformanceHistory(ownerId);

    let result;
    try {
      result = await generateMarketingPlan(context, {
        goalType: goal.goal_type,
        description: goal.description ?? null,
        targetValue: goal.target_value ?? null,
        timeframeDays: goal.timeframe_days,
        budgetAmount: goal.budget_amount ?? null,
      }, history);
    } catch (err) {
      const safe = toSafeError(err);
      await recordAiEvent({
        ownerId, eventType: 'STRATEGY_GENERATED', success: false,
        failureReason: safe.code, metadata: { goal_type: goal.goal_type },
      });
      return { ok: false as const, code: safe.code };
    }

    const { data: planRow, error: planError } = await supabase
      .from('marketing_plans')
      .insert({
        owner_id: ownerId,
        goal_id: goalRow.id,
        status: 'DRAFT',
        plan: result.plan,
        model: result.model,
      })
      .select('id')
      .single();

    if (planError || !planRow) {
      logSafeError('createGoalAndPlan.plan', planError);
      throw new AppError(ERROR_CODES.GENERATION_FAILED, 500);
    }

    await supabase.from('marketing_goals').update({ status: 'PLANNED' }).eq('id', goalRow.id).eq('owner_id', ownerId);

    await recordAiEvent({
      ownerId, eventType: 'STRATEGY_GENERATED', success: true,
      model: result.model, latencyMs: result.latencyMs,
      metadata: {
        goal_type: goal.goal_type,
        attempts: result.attempts,
        angles: result.plan.creative_angles.length,
        had_history: history.campaigns.length > 0,
      },
    });

    safeRevalidate('/goals');
    return { ok: true as const, planId: planRow.id as string };
  } catch (err) {
    logSafeError('createGoalAndPlan', err);
    if (ownerIdForEvent) {
      await recordAiEvent({
        ownerId: ownerIdForEvent, eventType: 'STRATEGY_GENERATED',
        success: false, failureReason: toSafeError(err).code,
      });
    }
    return { ok: false as const, code: toSafeError(err).code };
  }
}

export async function rejectPlan(planId: string, reason?: string) {
  try {
    const { supabase, ownerId } = await requireOwner();
    const { error } = await supabase
      .from('marketing_plans')
      .update({ status: 'REJECTED', rejected_reason: (reason || '').slice(0, 300) || null, updated_at: new Date().toISOString() })
      .eq('id', planId).eq('owner_id', ownerId).eq('status', 'DRAFT');
    if (error) throw new AppError(ERROR_CODES.GENERATION_FAILED, 500);

    await recordAiEvent({ ownerId, eventType: 'STRATEGY_REJECTED', success: true });
    safeRevalidate('/goals');
    return { ok: true as const };
  } catch (err) {
    logSafeError('rejectPlan', err);
    return { ok: false as const, code: toSafeError(err).code };
  }
}

/**
 * Approves a plan and turns it into a campaign.
 *
 * Deliberately goes through saveDraftCampaign, the same path the manual wizard
 * uses, so the campaign lands in unified_campaigns with the existing budget
 * safety, destination validation and approval workflow. There is no second
 * campaign system and no way for the AI to skip those checks.
 */
export async function approvePlanAndCreateCampaign(planId: string, landingUrl?: string) {
  try {
    const { supabase, ownerId } = await requireOwner();

    const { data: planRow } = await supabase
      .from('marketing_plans')
      .select('id, plan, status, goal_id')
      .eq('id', planId).eq('owner_id', ownerId).single();

    if (!planRow) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);
    if (planRow.status !== 'DRAFT') {
      return { ok: false as const, code: ERROR_CODES.CONFLICT };
    }

    const parsed = MarketingPlanSchema.safeParse(planRow.plan);
    if (!parsed.success) {
      return { ok: false as const, code: ERROR_CODES.VALIDATION_FAILED };
    }
    const plan: MarketingPlan = parsed.data;

    const context = await loadSalonContext(ownerId);
    const destination = plan.destination.type;
    const url = (landingUrl || context.profile?.booking_url || context.profile?.website_url || '').trim();

    if (destination === 'WEBSITE' && !url) {
      return { ok: false as const, code: 'DESTINATION_MISSING' };
    }

    // Claim the draft before creating a campaign so two concurrent approvals
    // cannot both mint campaigns from the same plan.
    const { data: claimed } = await supabase
      .from('marketing_plans')
      .update({
        status: 'CONVERTED',
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', planId).eq('owner_id', ownerId).eq('status', 'DRAFT')
      .select('id');

    if (!claimed || claimed.length === 0) {
      return { ok: false as const, code: ERROR_CODES.CONFLICT };
    }

    let campaignId: string;
    try {
      campaignId = await saveDraftCampaign({
        service: plan.recommended_service,
        offer: plan.recommended_offer || plan.recommended_service,
        budget_type: 'daily',
        budget_amount: plan.budget.daily_amount,
        duration_days: plan.budget.duration_days,
        destination_type: destination,
        landing_url: destination === 'WEBSITE' ? url : null,
        target_audience: plan.target_audience,
        location: plan.geography,
        channels: plan.channels,
      });
    } catch (err) {
      await supabase
        .from('marketing_plans')
        .update({ status: 'DRAFT', approved_at: null, updated_at: new Date().toISOString() })
        .eq('id', planId).eq('owner_id', ownerId).eq('status', 'CONVERTED').is('campaign_id', null);
      logSafeError('approvePlanAndCreateCampaign.campaign', err);
      return { ok: false as const, code: toSafeError(err).code };
    }

    await supabase
      .from('marketing_plans')
      .update({
        campaign_id: campaignId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', planId).eq('owner_id', ownerId);

    await logAudit(ownerId, 'MARKETING_PLAN_APPROVED', 'campaign', campaignId, null,
      { plan_id: planId }, 'Owner approved AI marketing plan; campaign created');

    await recordAiEvent({
      ownerId, eventType: 'PLAN_CONVERTED_TO_CAMPAIGN', success: true,
      metadata: { kpi: plan.primary_kpi, duration_days: plan.budget.duration_days },
    });

    safeRevalidate('/goals');
    safeRevalidate('/campaigns');
    return { ok: true as const, campaignId };
  } catch (err) {
    logSafeError('approvePlanAndCreateCampaign', err);
    return { ok: false as const, code: toSafeError(err).code };
  }
}
