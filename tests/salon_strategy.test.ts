import './setup';
import { MarketingPlanSchema } from '../src/lib/strategy/schema';
import { checkPlanGrounding } from '../src/lib/strategy/grounding';
import { buildLlmSalonContext, assertPromptIsSafe, LLM_ALLOWED_SALON_FIELDS } from '../src/lib/privacy/llm';
import { salonContextGaps, isSalonReadyForStrategy } from '../src/lib/salon/types';
import type { SalonContext } from '../src/lib/salon/types';

let pass = 0, fail = 0;
function assert(c: boolean, m: string) {
  if (c) { console.log('PASS: ' + m); pass++; } else { console.error('FAIL: ' + m); fail++; }
}

const service = (name: string, price = 999) => ({
  id: `s-${name}`, name, category: 'Hair', price, duration_minutes: 60,
  margin_tier: 'HIGH' as const, notes: null, is_active: true,
});

const context: SalonContext = {
  profile: {
    salon_name: 'Lakmé Rajajipuram', description: 'Family salon', location: 'Rajajipuram, Lucknow',
    service_areas: ['Rajajipuram'], website_url: 'https://x.example.com',
    booking_url: 'https://book.example.com', whatsapp_number: '+91 98765 43210',
    target_customer_types: ['Brides-to-be'], unique_selling_points: ['15 years'],
    brand_positioning: 'Premium local', preferred_tone: 'Warm',
    slow_days: ['Tuesday'], busy_days: ['Saturday'],
    default_destination_type: 'WEBSITE', currency: 'INR',
  },
  services: [service('Hair Spa'), service('Keratin', 4999)],
  offers: [{ id: 'o1', service_id: null, name: 'First visit Hair Spa ₹999', description: null,
    price: 999, terms: null, valid_from: null, valid_to: null, is_active: true }],
};

const validPlan = {
  objective: 'Bring 30 new bookings for Hair Spa in Rajajipuram over 30 days.',
  primary_kpi: 'BOOKINGS',
  recommended_service: 'Hair Spa',
  recommended_offer: 'First visit Hair Spa ₹999',
  why_this_service: 'It has the highest margin and an existing first-visit offer.',
  target_audience: 'Women 25-40 in Rajajipuram who have not visited before',
  geography: 'Rajajipuram, Lucknow',
  channels: ['google'],
  budget: { daily_amount: 1500, duration_days: 30 },
  destination: { type: 'WEBSITE', rationale: 'Google Search ads need a web page to send people to.' },
  messaging_strategy: 'Lead with the first-visit price, then the salon being local and established.',
  creative_angles: [
    { name: 'Affordable first visit', description: 'The ₹999 first visit removes the risk of trying somewhere new.' },
    { name: 'Local and established', description: 'Fifteen years in Rajajipuram, so they are not gambling.' },
  ],
  measurement_plan: 'Count enquiries and how many become paying customers over 30 days.',
  assumptions: ['The salon can take extra Tuesday bookings'],
  risks: ['Wedding season may raise competition'],
  claims: [
    { kind: 'RECOMMENDATION', statement: 'Promote Hair Spa this month.' },
    { kind: 'INFERENCE', statement: 'A first-visit price lowers the barrier for new customers.' },
  ],
};

async function main() {
  console.log('--- SALON CONTEXT GATES THE STRATEGIST ---');

  assert(isSalonReadyForStrategy(context), 'A complete salon is ready for strategy');
  assert(salonContextGaps({ ...context, services: [] }).includes('At least one service'),
    'No services is reported as a gap');
  assert(salonContextGaps({ ...context, profile: null }).length >= 2,
    'A missing profile reports several gaps');
  assert(!isSalonReadyForStrategy({ ...context, services: [] }),
    'A salon with no services cannot be planned for');

  console.log('\n--- THE SALON CONTEXT SENT TO THE AI IS FILTERED ---');

  const llm = buildLlmSalonContext(
    context.profile as unknown as Record<string, unknown>,
    context.services as unknown as Record<string, unknown>[],
    context.offers as unknown as Record<string, unknown>[]
  );
  const serialised = JSON.stringify(llm);

  assert(!serialised.includes('98765'), "The salon's WhatsApp number is never sent");
  assert(!serialised.includes('book.example.com'), 'The booking URL is never sent');
  assert(!serialised.includes('x.example.com'), 'The website URL is never sent');
  assert(llm.salon_name === 'Lakmé Rajajipuram', 'The salon name is sent');
  assert(llm.services.length === 2 && llm.services[0].price === 999, 'Services and prices are sent');
  assert(llm.slow_days.includes('Tuesday'), 'Quiet days are sent so capacity can be respected');
  assert(Object.keys(llm).length === LLM_ALLOWED_SALON_FIELDS.length + 2,
    'Only allow-listed fields plus services and offers are present');

  let guardFired = false;
  try { assertPromptIsSafe(`Salon context ${serialised}`); } catch { guardFired = true; }
  assert(!guardFired, 'The filtered salon context passes the prompt safety guard');

  let blocked = false;
  try { assertPromptIsSafe('Contact the salon on +91 98765 43210'); } catch { blocked = true; }
  assert(blocked, 'An unfiltered phone number would still be blocked');

  const inactive = buildLlmSalonContext(
    context.profile as unknown as Record<string, unknown>,
    [{ ...service('Retired Service'), is_active: false }] as unknown as Record<string, unknown>[],
    []
  );
  assert(inactive.services.length === 0, 'Inactive services are not offered to the AI');

  console.log('\n--- A PLAN MUST PARSE ---');

  assert(MarketingPlanSchema.safeParse(validPlan).success, 'A well-formed plan parses');
  assert(!MarketingPlanSchema.safeParse({ ...validPlan, primary_kpi: 'VIBES' }).success,
    'An invented KPI is rejected');
  assert(!MarketingPlanSchema.safeParse({ ...validPlan, channels: ['tiktok'] }).success,
    'An unsupported channel is rejected');
  assert(!MarketingPlanSchema.safeParse({ ...validPlan, creative_angles: [validPlan.creative_angles[0]] }).success,
    'Fewer than two creative angles is rejected');
  assert(!MarketingPlanSchema.safeParse({ ...validPlan, budget: { daily_amount: -5, duration_days: 30 } }).success,
    'A negative budget is rejected');
  assert(!MarketingPlanSchema.safeParse({ ...validPlan, claims: [] }).success,
    'A plan with no stated basis is rejected');
  assert(!MarketingPlanSchema.safeParse({}).success, 'An empty object is rejected');

  console.log('\n--- HALLUCINATION PROTECTION ---');

  const constraints = { maxDailyBudget: 1500, maxDurationDays: 30 };
  const parsed = MarketingPlanSchema.parse(validPlan);

  assert(checkPlanGrounding(parsed, context, constraints).length === 0,
    'A grounded plan passes');

  const invented = MarketingPlanSchema.parse({ ...validPlan, recommended_service: 'Laser Hair Removal' });
  const inventedFailures = checkPlanGrounding(invented, context, constraints);
  assert(inventedFailures.some((f) => f.field === 'recommended_service'),
    'A service the salon does not offer is rejected');
  assert(inventedFailures[0].problem.includes('Hair Spa'),
    'And the rejection names the services that do exist');

  const fakeOffer = MarketingPlanSchema.parse({ ...validPlan, recommended_offer: '90% off everything' });
  assert(checkPlanGrounding(fakeOffer, context, constraints).some((f) => f.field === 'recommended_offer'),
    'An offer the salon never made is rejected');

  const noOffersSalon = { ...context, offers: [] };
  assert(checkPlanGrounding(fakeOffer, noOffersSalon, constraints).every((f) => f.field !== 'recommended_offer'),
    'When the salon has no offers on file, proposed offer wording is allowed for the owner to approve');

  const overBudget = MarketingPlanSchema.parse({ ...validPlan, budget: { daily_amount: 9000, duration_days: 30 } });
  assert(checkPlanGrounding(overBudget, context, constraints).some((f) => f.field === 'budget.daily_amount'),
    "A budget above the owner's ceiling is rejected");

  const overTime = MarketingPlanSchema.parse({ ...validPlan, budget: { daily_amount: 1500, duration_days: 90 } });
  assert(checkPlanGrounding(overTime, context, constraints).some((f) => f.field === 'budget.duration_days'),
    'A duration beyond what was asked for is rejected');

  const badDestination = MarketingPlanSchema.parse({
    ...validPlan,
    destination: { type: 'WHATSAPP', rationale: 'People prefer messaging.' },
  });
  assert(checkPlanGrounding(badDestination, context, constraints).some((f) => f.field === 'destination.type'),
    'Google Search with a non-website destination is rejected');

  const unsupportedFact = MarketingPlanSchema.parse({
    ...validPlan,
    claims: [{ kind: 'FACT', statement: 'Hair Spa outperforms Keratin by 28%.' }],
  });
  assert(checkPlanGrounding(unsupportedFact, context, constraints).some((f) => f.field === 'claims'),
    'A FACT with no evidence is rejected -- the model cannot assert numbers it was not given');

  const supportedFact = MarketingPlanSchema.parse({
    ...validPlan,
    claims: [{ kind: 'FACT', statement: 'Hair Spa produced 12 bookings.', evidence: 'Hair Spa: 12 bookings' }],
  });
  assert(checkPlanGrounding(supportedFact, context, constraints).length === 0,
    'A FACT that cites its evidence is accepted');

  console.log(`\n--- SALON STRATEGY: ${pass} PASS, ${fail} FAIL ---`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
