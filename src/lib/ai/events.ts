import { createClient } from '@/lib/supabase/server';
import { AppError, ERROR_CODES } from '@/lib/errors';

/**
 * Observability for AI work.
 *
 * Records what happened, how long it took and whether it worked -- never the
 * prompt or the completion. Salon and customer text must not end up in an
 * events table, so only counts and identifiers are kept.
 */
export type AiEvent = {
  ownerId: string;
  eventType:
    | 'STRATEGY_GENERATED'
    | 'STRATEGY_APPROVED'
    | 'STRATEGY_REJECTED'
    | 'PLAN_CONVERTED_TO_CAMPAIGN'
    | 'CREATIVE_GENERATED'
    | 'ANALYSIS_RUN'
    | 'RECOMMENDATION_GENERATED'
    | 'RECOMMENDATION_APPROVED'
    | 'RECOMMENDATION_DISMISSED'
    | 'ASSISTANT_QUERY';
  provider?: string;
  model?: string;
  latencyMs?: number;
  success: boolean;
  failureReason?: string;
  /** Safe scalars only: counts, ids, enum values. Never free text from a model. */
  metadata?: Record<string, string | number | boolean | null>;
};

export async function recordAiEvent(event: AiEvent): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.from('ai_events').insert({
      owner_id: event.ownerId,
      event_type: event.eventType,
      provider: event.provider ?? 'google',
      model: event.model ?? null,
      latency_ms: event.latencyMs ?? null,
      success: event.success,
      failure_reason: event.failureReason ?? null,
      metadata: event.metadata ?? {},
    });
  } catch {
    // Observability must never break the thing it observes.
  }
}

export async function assertAiRateLimit(
  ownerId: string,
  eventType: AiEvent['eventType'],
  maxPerHour: number
): Promise<void> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, data, error } = await supabase
    .from('ai_events')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
    .eq('event_type', eventType)
    .gte('created_at', since);
  if (error) throw new AppError(ERROR_CODES.GENERATION_FAILED, 500);
  const n = typeof count === 'number' ? count : Array.isArray(data) ? data.length : 0;
  if (n >= maxPerHour) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, 429);
  }
}
