import { generateStructuredJson } from '@/lib/llm/gemini';
import { buildLlmSalonContext } from '@/lib/privacy/llm';
import { AppError, ERROR_CODES } from '@/lib/errors';
import { z } from 'zod';
import type { SalonContext } from '@/lib/salon/types';
import type { CampaignPerformance, PerformanceTotals } from '@/lib/metrics/performance';
import type { Finding } from '@/lib/analysis/findings';

/**
 * The salon's marketing assistant.
 *
 * Answers only from figures already computed and shown elsewhere in the app.
 * It receives aggregates -- never a lead's name, phone or email -- and is told
 * to say it does not know rather than estimate. Its answer is schema-validated
 * before display.
 */

export const AssistantAnswerSchema = z.object({
  answer: z.string().trim().min(5).max(1500),
  /** Figures the answer leaned on, echoed back so the owner can check them. */
  figures_used: z.array(z.object({
    label: z.string().trim().max(120),
    value: z.string().trim().max(120),
  })).max(8).default([]),
  /** True when the data cannot support an answer. */
  insufficient_data: z.boolean(),
  suggested_next_step: z.string().trim().max(300).optional().nullable(),
});

export type AssistantAnswer = z.infer<typeof AssistantAnswerSchema>;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    answer: { type: 'STRING' },
    figures_used: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { label: { type: 'STRING' }, value: { type: 'STRING' } },
        required: ['label', 'value'],
      },
    },
    insufficient_data: { type: 'BOOLEAN' },
    suggested_next_step: { type: 'STRING' },
  },
  required: ['answer', 'insufficient_data'],
};

function money(v: number | null, currency: string): string {
  return v === null ? 'not known' : `${currency} ${Math.round(v)}`;
}

export function buildAssistantContext(
  salon: SalonContext,
  campaigns: CampaignPerformance[],
  totals: PerformanceTotals,
  findings: Finding[]
): string {
  const s = buildLlmSalonContext(
    salon.profile as unknown as Record<string, unknown> | null,
    salon.services as unknown as Record<string, unknown>[],
    salon.offers as unknown as Record<string, unknown>[]
  );

  const campaignLines = campaigns.length
    ? campaigns.map((c) =>
        `- ${c.name}${c.untraceable ? ' (enquiries that could not be traced to any campaign)' : ''}: ` +
        `spent ${money(c.spend, totals.currency)}, ${c.leads} enquiries, ${c.booked} reached booked, ` +
        `${c.paid} paying customers, revenue ${totals.currency} ${c.revenue}, ` +
        `cost per enquiry ${money(c.costPerLead, totals.currency)}, ` +
        `cost per paying customer ${money(c.costPerPayingCustomer, totals.currency)}`
      ).join('\n')
    : '- none';

  const findingLines = findings.length
    ? findings.map((f) => `- ${f.title} (confidence ${f.confidence}) — ${f.evidence.map((e) => `${e.label} ${e.value}`).join(', ')}`).join('\n')
    : '- none';

  return `THE SALON
Name: ${s.salon_name || 'not set'}
Area: ${s.location || 'not set'}
Services: ${s.services.map((x) => `${x.name}${x.price !== null ? ` (${s.currency} ${x.price})` : ''}`).join(', ') || 'none listed'}
Offers: ${s.offers.map((x) => x.name).join(', ') || 'none listed'}
Quiet days: ${s.slow_days.join(', ') || 'not stated'}
Busy days: ${s.busy_days.join(', ') || 'not stated'}

OVERALL MEASURED RESULTS
Spent: ${money(totals.spend, totals.currency)}
Enquiries: ${totals.leads}
Paying customers: ${totals.paying}
Revenue: ${totals.currency} ${totals.revenue}
Cost per enquiry: ${money(totals.costPerLead, totals.currency)}
Cost per paying customer: ${money(totals.costPerPayingCustomer, totals.currency)}
Enquiries that could not be traced to a campaign: ${totals.untraceableLeads}

PER CAMPAIGN
${campaignLines}

WHAT THE ANALYSIS FOUND
${findingLines}`;
}

export async function answerSalonQuestion(
  question: string,
  context: string
): Promise<{ answer: AssistantAnswer; model: string; latencyMs: number }> {
  const trimmed = question.trim();
  if (trimmed.length < 3 || trimmed.length > 500) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400);
  }

  const prompt = `You are the marketing assistant for one Indian salon. Answer the owner's
question using ONLY the data below.

RULES
1. Never invent a number. If the data does not answer the question, set
   insufficient_data to true and say plainly what is missing.
2. Never estimate, project or extrapolate. "Not known" is a good answer.
3. Quote figures exactly as given, and list them in figures_used.
4. Write for an owner with no marketing training. No jargon: no CPC, CTR, ROAS,
   impressions, ad groups or match types. Talk about money, enquiries, customers.
5. Do not give medical, legal or financial advice, and do not discuss anything
   outside this salon's marketing.
6. Keep it to a few sentences.

${context}

THE OWNER ASKS: ${trimmed}`;

  const { data, model, latencyMs } = await generateStructuredJson<unknown>({
    prompt,
    responseSchema: RESPONSE_SCHEMA,
    temperature: 0.2,
  });

  const parsed = AssistantAnswerSchema.safeParse(data);
  if (!parsed.success) {
    throw new AppError(ERROR_CODES.LLM_INVALID_OUTPUT, 502);
  }

  return { answer: parsed.data, model, latencyMs };
}
