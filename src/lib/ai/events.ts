import { createClient } from '@/lib/supabase/server';

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
