import type { MarketingPlan } from './schema';
import type { SalonContext } from '@/lib/salon/types';

/**
 * Hallucination protection.
 *
 * Schema validation proves the plan is well-formed; these checks prove it is
 * about THIS salon. A plan that recommends a service the salon does not offer,
 * an offer that does not exist, or a budget the owner did not agree to is
 * rejected outright rather than shown as advice.
 */

export type GroundingFailure = { field: string; problem: string };

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function checkPlanGrounding(
  plan: MarketingPlan,
  context: SalonContext,
  constraints: { maxDailyBudget: number | null; maxDurationDays: number }
): GroundingFailure[] {
  const failures: GroundingFailure[] = [];

  const activeServices = context.services.filter((s) => s.is_active);
  const serviceNames = new Set(activeServices.map((s) => normalise(s.name)));

  if (!serviceNames.has(normalise(plan.recommended_service))) {
    failures.push({
      field: 'recommended_service',
      problem: `"${plan.recommended_service}" is not one of the salon's services. Choose exactly one of: ${activeServices.map((s) => s.name).join(', ')}.`,
    });
  }

  // If the salon has offers on file, the plan must use one of them. If it has
  // none, the strategist may propose offer wording -- the owner approves or
  // rejects it when reviewing the plan, so it is a proposal, not a fabrication.
  const activeOffers = context.offers.filter((o) => o.is_active);
  if (plan.recommended_offer && activeOffers.length > 0) {
    const offerNames = new Set(activeOffers.map((o) => normalise(o.name)));
    if (!offerNames.has(normalise(plan.recommended_offer))) {
      failures.push({
        field: 'recommended_offer',
        problem: `"${plan.recommended_offer}" is not one of the salon's offers. Use one of: ${activeOffers.map((o) => o.name).join(', ')}.`,
      });
    }
  }

  // The owner's budget is a ceiling, not a suggestion.
  if (constraints.maxDailyBudget !== null && plan.budget.daily_amount > constraints.maxDailyBudget) {
    failures.push({
      field: 'budget.daily_amount',
      problem: `Daily budget ${plan.budget.daily_amount} exceeds the ${constraints.maxDailyBudget} the owner set.`,
    });
  }

  if (plan.budget.duration_days > constraints.maxDurationDays) {
    failures.push({
      field: 'budget.duration_days',
      problem: `Duration ${plan.budget.duration_days} exceeds the ${constraints.maxDurationDays} days requested.`,
    });
  }

  // Google Search ads must land on a web page; the destination gate rejects
  // anything else at approval time, so catch it here rather than later.
  if (plan.channels.includes('google') && plan.destination.type !== 'WEBSITE') {
    failures.push({
      field: 'destination.type',
      problem: 'Google Search campaigns must send people to a website. Use WEBSITE.',
    });
  }

  // A FACT has to point at something. Unsupported facts become inferences.
  for (const claim of plan.claims) {
    if (claim.kind === 'FACT' && !claim.evidence?.trim()) {
      failures.push({
        field: 'claims',
        problem: `The claim "${claim.statement.slice(0, 60)}…" is marked FACT but cites no evidence. Mark it INFERENCE or cite the figure it comes from.`,
      });
    }
  }

  return failures;
}
