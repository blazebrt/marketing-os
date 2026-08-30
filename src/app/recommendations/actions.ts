'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { AppError, ERROR_CODES, logSafeError, toSafeError } from '@/lib/errors';
import { refreshRecommendations } from '@/lib/analysis/recommendations';
import { recordAiEvent, assertAiRateLimit } from '@/lib/ai/events';
import { logAudit } from '@/lib/audit';
import { isUuid } from '@/lib/ids';

function safeRevalidate(path: string) {
  try { revalidatePath(path); } catch { /* no store outside a request */ }
}

async function requireOwner() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);
  return { supabase, ownerId: user.id };
}

/** Re-runs the deterministic analysis and refreshes the recommendation list. */
export async function analyseNow() {
  try {
    const { ownerId } = await requireOwner();
    await assertAiRateLimit(ownerId, 'ANALYSIS_RUN', 20);
    const started = Date.now();
    const { generated } = await refreshRecommendations(ownerId);

    await recordAiEvent({
      ownerId, eventType: 'ANALYSIS_RUN', success: true,
      latencyMs: Date.now() - started, metadata: { findings: generated },
    });

    safeRevalidate('/');
    safeRevalidate('/recommendations');
    return { ok: true as const, generated };
  } catch (err) {
    logSafeError('analyseNow', err);
    return { ok: false as const, code: toSafeError(err).code };
  }
}

/**
 * Records the owner's decision on a recommendation.
 *
 * Approving marks intent only. It never changes a budget, launches anything, or
 * touches Google -- every consequential action still runs through the existing
 * campaign and mutation safeguards, by hand.
 */
export async function decideRecommendation(id: string, decision: 'APPROVED' | 'DISMISSED') {
  try {
    const { supabase, ownerId } = await requireOwner();
    if (!isUuid(id) || (decision !== 'APPROVED' && decision !== 'DISMISSED')) {
      return { ok: false as const, code: ERROR_CODES.VALIDATION_FAILED };
    }

    const { data: updated, error } = await supabase
      .from('recommendations')
      .update({ status: decision, decided_at: new Date().toISOString() })
      .eq('id', id).eq('owner_id', ownerId).eq('status', 'OPEN')
      .select('id, kind, campaign_id');

    if (error) throw new AppError(ERROR_CODES.GENERATION_FAILED, 500);
    if (!updated || updated.length === 0) {
      return { ok: false as const, code: ERROR_CODES.CONFLICT };
    }

    await logAudit(ownerId, `RECOMMENDATION_${decision}`, 'recommendation', id, null,
      { kind: updated[0].kind }, 'Owner decision on AI recommendation');
    await recordAiEvent({
      ownerId,
      eventType: decision === 'APPROVED' ? 'RECOMMENDATION_APPROVED' : 'RECOMMENDATION_DISMISSED',
      success: true, metadata: { kind: String(updated[0].kind) },
    });

    safeRevalidate('/');
    safeRevalidate('/recommendations');
    return { ok: true as const, campaignId: updated[0].campaign_id as string | null };
  } catch (err) {
    logSafeError('decideRecommendation', err);
    return { ok: false as const, code: toSafeError(err).code };
  }
}
