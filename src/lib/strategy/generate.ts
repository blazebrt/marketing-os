import { generateStructuredJson } from '@/lib/llm/gemini';
import { buildLlmSalonContext } from '@/lib/privacy/llm';
import { AppError, ERROR_CODES, logSafeError } from '@/lib/errors';
import { MarketingPlanSchema, MARKETING_PLAN_RESPONSE_SCHEMA, type MarketingPlan } from './schema';
import { checkPlanGrounding, type GroundingFailure } from './grounding';
import type { SalonContext } from '@/lib/salon/types';

/**
 * The AI marketing strategist.
 *
 * Produces a MarketingPlan from the salon's own description, its services and
 * offers, the owner's goal, and whatever real performance history exists.
 *
 * Nothing is trusted: output is parsed by MarketingPlanSchema, then checked
 * against the salon's actual services and the owner's budget. A plan that fails
 * either is regenerated with the failures fed back; if it still fails, the call
 * errors rather than presenting an ungrounded plan as advice.
 */

export type GoalInput = {
  goalType: string;
  description: string | null;
  targetValue: number | null;
  timeframeDays: number;
  budgetAmount: number | null;
};

/** Real, measured history. Empty when the salon has never run a campaign. */
export type PerformanceHistory = {
  campaigns: {
    service: string;
    spend: number | null;
    leads: number;
    bookings: number;
    paying: number;
    revenue: number;
  }[];
  totalSpend: number | null;
  totalLeads: number;
  totalBookings: number;
};

const MAX_ATTEMPTS = 3;

function historySection(history: PerformanceHistory): string {
  if (history.campaigns.length === 0) {
    return `PAST PERFORMANCE
None. This salon has no completed campaign results yet.
You therefore have NO performance facts. Do not claim any campaign performed
better or worse than another. Any claim about what will work is an INFERENCE or
a RECOMMENDATION, never a FACT.`;
  }

  const lines = history.campaigns.map(
    (c) =>
      `- ${c.service}: spent ${c.spend ?? 'unknown'}, ${c.leads} leads, ${c.bookings} bookings, ${c.paying} paying customers, revenue ${c.revenue}`
  );
  return `PAST PERFORMANCE (real measured figures)
${lines.join('\n')}
Totals: spend ${history.totalSpend ?? 'unknown'}, ${history.totalLeads} leads, ${history.totalBookings} bookings.
You may cite these as FACT. Cite the actual numbers as evidence. Do not
extrapolate beyond them.`;
}

function buildPrompt(
  salon: ReturnType<typeof buildLlmSalonContext>,
  goal: GoalInput,
  history: PerformanceHistory,
  maxDailyBudget: number | null,
  previousFailures?: GroundingFailure[]
): string {
  const serviceList = salon.services
    .map((s) => `- ${s.name}${s.category ? ` (${s.category})` : ''}${s.price !== null ? ` — ${salon.currency} ${s.price}` : ''}${s.margin_tier ? ` — ${s.margin_tier} margin` : ''}`)
    .join('\n') || '- (none listed)';

  const offerList = salon.offers
    .map((o) => `- ${o.name}${o.price !== null ? ` — ${salon.currency} ${o.price}` : ''}${o.description ? `: ${o.description}` : ''}`)
    .join('\n') || '- (none listed)';

  const capacity = [
    salon.slow_days.length ? `Quiet days: ${salon.slow_days.join(', ')}. Prefer filling these.` : '',
    salon.busy_days.length ? `Busy days: ${salon.busy_days.join(', ')}. Avoid adding demand here.` : '',
  ].filter(Boolean).join('\n') || 'No capacity information supplied.';

  const retry = previousFailures?.length
    ? `\nYOUR PREVIOUS ATTEMPT WAS REJECTED. Fix every one of these and try again:\n${previousFailures.map((f) => `- ${f.field}: ${f.problem}`).join('\n')}\n`
    : '';

  return `You are a marketing strategist for a single Indian salon. Produce ONE marketing plan.

THE SALON
Name: ${salon.salon_name || 'unnamed'}
Area: ${salon.location || 'not specified'}
Also serves: ${salon.service_areas.join(', ') || 'not specified'}
About: ${salon.description || 'not specified'}
Customers: ${salon.target_customer_types.join(', ') || 'not specified'}
What makes it different: ${salon.unique_selling_points.join('; ') || 'not specified'}
Positioning: ${salon.brand_positioning || 'not specified'}
Preferred tone: ${salon.preferred_tone || 'warm and professional'}
Currency: ${salon.currency}

SERVICES THE SALON ACTUALLY OFFERS
${serviceList}

OFFERS THAT ACTUALLY EXIST
${offerList}

CAPACITY
${capacity}

THE OWNER'S GOAL
Type: ${goal.goalType}
In their words: ${goal.description || 'not elaborated'}
${goal.targetValue !== null ? `Target: ${goal.targetValue}` : 'No numeric target given.'}
Timeframe: ${goal.timeframeDays} days
${maxDailyBudget !== null ? `Maximum daily budget: ${salon.currency} ${maxDailyBudget}. NEVER exceed this.` : 'No budget stated. Propose a modest daily budget appropriate to a single local salon.'}

${historySection(history)}

HARD RULES
1. recommended_service MUST be copied exactly from the services list above.
   Never invent a service, and never suggest one the salon does not offer.
2. recommended_offer: if the offers list above is not empty, copy one from it
   exactly. If the salon has no offers on file, you may propose offer wording --
   the owner will approve or reject it. Never claim a proposed offer already
   exists.
3. Never invent numbers. If you have no performance data, say so.
4. Label every claim: FACT only for figures given above, with the figure quoted
   as evidence; INFERENCE for reasoning; RECOMMENDATION for advice.
5. The only channel available is google. Google Search ads must send people to a
   WEBSITE.
6. Stay within the budget and timeframe given.
7. Write for an owner with no marketing training. No jargon: no CPC, CTR, ROAS,
   ad groups or match types. Plain language about customers and bookings.
8. Give 3 to 4 distinct creative angles, each a genuinely different reason a
   customer would book.
${retry}`;
}

export type StrategyResult = {
  plan: MarketingPlan;
  model: string;
  latencyMs: number;
  attempts: number;
};

export async function generateMarketingPlan(
  context: SalonContext,
  goal: GoalInput,
  history: PerformanceHistory
): Promise<StrategyResult> {
  const salon = buildLlmSalonContext(
    context.profile as unknown as Record<string, unknown> | null,
    context.services as unknown as Record<string, unknown>[],
    context.offers as unknown as Record<string, unknown>[]
  );

  if (salon.services.length === 0) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400);
  }

  const constraints = {
    maxDailyBudget: goal.budgetAmount,
    maxDurationDays: goal.timeframeDays,
  };

  let failures: GroundingFailure[] | undefined;
  let totalLatency = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const prompt = buildPrompt(salon, goal, history, goal.budgetAmount, failures);

    const { data, model, latencyMs } = await generateStructuredJson<unknown>({
      prompt,
      responseSchema: MARKETING_PLAN_RESPONSE_SCHEMA,
      temperature: 0.5,
    });
    totalLatency += latencyMs;

    const parsed = MarketingPlanSchema.safeParse(data);
    if (!parsed.success) {
      failures = parsed.error.issues.slice(0, 8).map((i) => ({
        field: i.path.join('.') || 'plan',
        problem: i.message,
      }));
      continue;
    }

    const grounding = checkPlanGrounding(parsed.data, context, constraints);
    if (grounding.length > 0) {
      failures = grounding;
      continue;
    }

    return { plan: parsed.data, model, latencyMs: totalLatency, attempts: attempt };
  }

  logSafeError('generateMarketingPlan', new Error(`ungrounded after ${MAX_ATTEMPTS} attempts`));
  throw new AppError(ERROR_CODES.LLM_INVALID_OUTPUT, 502);
}
