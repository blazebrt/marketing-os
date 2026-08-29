'use server';

import { createClient } from '@/lib/supabase/server';
import { AppError, ERROR_CODES, logSafeError, toSafeError } from '@/lib/errors';
import { loadSalonContext } from '@/lib/salon/context';
import { buildPerformance, type SpendRow, type LeadRow } from '@/lib/metrics/performance';
import { analysePerformance } from '@/lib/analysis/findings';
import { buildAssistantContext, answerSalonQuestion, type AssistantAnswer } from '@/lib/assistant/answer';
import { recordAiEvent } from '@/lib/ai/events';

export async function askAssistant(question: string): Promise<
  { ok: true; answer: AssistantAnswer } | { ok: false; code: string }
> {
  let ownerIdForEvent: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);
    ownerIdForEvent = user.id;

    const [{ data: spend }, { data: leads }, { data: campaigns }, salon] = await Promise.all([
      supabase.from('campaign_daily_metrics')
        .select('google_campaign_id, google_campaign_name, campaign_id, cost_amount, impressions, clicks, currency_code, metric_date')
        .eq('owner_id', user.id),
      // Aggregates only: no name, phone or email is ever loaded here.
      supabase.from('leads')
        .select('id, status, revenue_amount, attributed_google_campaign_id, gclid, attribution_checked_at')
        .eq('owner_id', user.id),
      supabase.from('unified_campaigns').select('id, service').eq('owner_id', user.id),
      loadSalonContext(user.id),
    ]);

    const names = new Map<string, string>(
      (campaigns || []).map((c: { id: string; service: string }) => [c.id, c.service])
    );
    const { campaigns: rows, totals } = buildPerformance(
      (spend || []) as SpendRow[], (leads || []) as LeadRow[], names
    );
    const findings = analysePerformance(rows, totals);
    const context = buildAssistantContext(salon, rows, totals, findings);

    const { answer, model, latencyMs } = await answerSalonQuestion(question, context);

    await recordAiEvent({
      ownerId: user.id, eventType: 'ASSISTANT_QUERY', success: true,
      model, latencyMs,
      metadata: { insufficient_data: answer.insufficient_data, figures: answer.figures_used.length },
    });

    return { ok: true, answer };
  } catch (err) {
    logSafeError('askAssistant', err);
    const safe = toSafeError(err);
    if (ownerIdForEvent) {
      await recordAiEvent({
        ownerId: ownerIdForEvent, eventType: 'ASSISTANT_QUERY',
        success: false, failureReason: safe.code,
      });
    }
    return { ok: false, code: safe.code };
  }
}
