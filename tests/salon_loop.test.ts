import './setup';
import crypto from 'crypto';
import type { PGlite } from '@electric-sql/pglite';
import { __setMockCreateClient } from '../src/lib/supabase/server';
import { createM7Database, setAuthUid } from './helpers/m7Harness';
import { createPgliteSupabase } from './helpers/pgliteSupabase';
import { startStubGemini } from './helpers/stubGemini';

import { createGoalAndPlan, approvePlanAndCreateCampaign } from '../src/app/goals/actions';
import { verifyCampaign, approveCampaign } from '../src/app/campaigns/actions';
import { generateAndSaveGoogleCreatives } from '../src/lib/providers/google/generative';
import { updateGoogleCreativeItem } from '../src/app/campaigns/[id]/google/actions';
import { analyseNow, decideRecommendation } from '../src/app/recommendations/actions';

/**
 * The whole loop, end to end, against a real database.
 *
 * Everything below runs the shipped server actions on a Postgres built from the
 * real migrations, with only the model replaced by a local stub. Nothing is
 * re-implemented in the test, so a passing run means the owner's journey works:
 *
 *   goal -> understand the salon -> strategy -> owner approves -> campaign ->
 *   strategic creatives -> owner approves creatives -> ready to deploy ->
 *   measured results -> analysis -> recommendation -> owner decides
 *
 * It also proves the two things that must NOT happen: an ungrounded plan is
 * never stored, and approving a recommendation never spends money by itself.
 */

let pass = 0;
let fail = 0;
function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`PASS: ${label}`);
    pass++;
  } else {
    console.error(`FAIL: ${label}`);
    fail++;
  }
}

const OWNER = '11111111-1111-4111-8111-111111111111';
const GOOGLE_CAMPAIGN_ID = '9988776655';

const SALON = {
  salon_name: 'Lakme Salon Rajajipuram',
  description: 'A neighbourhood salon in west Lucknow known for bridal work and hair care.',
  location: 'Rajajipuram, Lucknow',
  service_areas: ['Rajajipuram', 'Alambagh', 'Aashiana'],
  website_url: 'https://salon-example.test/',
  booking_url: 'https://salon-example.test/book-now',
  whatsapp_number: '+919812345678',
  target_customer_types: ['Brides', 'Working women', 'College students'],
  unique_selling_points: ['Certified bridal artists', 'Open until 9pm'],
  brand_positioning: 'Premium but approachable',
  preferred_tone: 'warm and reassuring',
  slow_days: ['Tuesday', 'Wednesday'],
  busy_days: ['Saturday', 'Sunday'],
};

const SERVICES = [
  { name: 'Bridal Makeup', category: 'Makeup', price: 15000, margin_tier: 'HIGH' },
  { name: 'Hair Spa', category: 'Hair', price: 1800, margin_tier: 'MEDIUM' },
  { name: 'Keratin Treatment', category: 'Hair', price: 6000, margin_tier: 'HIGH' },
];

const OFFER = { name: 'Monsoon Hair Spa Package', description: 'Two hair spa sittings booked together.', price: 3000 };

/**
 * A plan that names a service this salon does not offer. Identical to the
 * grounded plan in every other respect, so the only thing that can reject it is
 * the check that the recommended service is real.
 */
function hallucinatedPlan() {
  return {
    ...groundedPlan(),
    recommended_service: 'Nail Art Extensions',
  };
}

/** A plan that stays inside the salon's real services, offers and budget. */
function groundedPlan() {
  return {
    objective: 'Fill quiet Tuesday and Wednesday chairs with hair spa bookings over the next month.',
    primary_kpi: 'BOOKINGS',
    recommended_service: 'Hair Spa',
    recommended_offer: 'Monsoon Hair Spa Package',
    why_this_service:
      'Hair spa is quick to deliver, sits in the middle of the price list and is the easiest booking to win from a first-time visitor.',
    target_audience: 'Working women aged 25 to 40 living within a few kilometres of Rajajipuram',
    geography: 'Rajajipuram and nearby Lucknow neighbourhoods',
    channels: ['google'],
    budget: { daily_amount: 600, duration_days: 30 },
    destination: { type: 'WEBSITE', rationale: 'The booking page lets someone pick a slot without calling.' },
    messaging_strategy:
      'Lead with the quiet-day convenience and the package price, and reassure first-time visitors that the salon is close by and open late.',
    creative_angles: [
      { name: 'Midweek calm', description: 'Come on a Tuesday or Wednesday when the salon is unhurried and you get the full session.' },
      { name: 'Package value', description: 'Two sittings booked together works out cheaper than two separate visits.' },
      { name: 'Close to home', description: 'A short walk or ride from Rajajipuram, open until nine in the evening.' },
    ],
    measurement_plan: 'Count bookings that come from the website, and compare them against what the month costs to run.',
    assumptions: ['Quiet midweek slots stay available through the month'],
    risks: ['Monsoon weather may reduce walk-ins regardless of advertising'],
    claims: [
      { kind: 'INFERENCE', statement: 'Midweek demand is softer than weekend demand at this salon.' },
      { kind: 'RECOMMENDATION', statement: 'Promote the existing hair spa package rather than discounting bridal work.' },
    ],
  };
}

async function seedSalon(db: PGlite) {
  await db.query(
    `insert into public.salon_profile
      (owner_id, salon_name, description, location, service_areas, website_url, booking_url, whatsapp_number,
       target_customer_types, unique_selling_points, brand_positioning, preferred_tone, slow_days, busy_days,
       default_destination_type, currency)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'WEBSITE','INR')`,
    [
      OWNER, SALON.salon_name, SALON.description, SALON.location, SALON.service_areas,
      SALON.website_url, SALON.booking_url, SALON.whatsapp_number, SALON.target_customer_types,
      SALON.unique_selling_points, SALON.brand_positioning, SALON.preferred_tone,
      SALON.slow_days, SALON.busy_days,
    ]
  );

  for (const s of SERVICES) {
    await db.query(
      `insert into public.salon_services (owner_id, name, category, price, margin_tier, is_active)
       values ($1,$2,$3,$4,$5,true)`,
      [OWNER, s.name, s.category, s.price, s.margin_tier]
    );
  }

  await db.query(
    `insert into public.salon_offers (owner_id, name, description, price, is_active)
     values ($1,$2,$3,$4,true)`,
    [OWNER, OFFER.name, OFFER.description, OFFER.price]
  );
}

async function main() {
  const db = await createM7Database();
  await setAuthUid(db, OWNER);
  __setMockCreateClient(() => createPgliteSupabase(db, OWNER));

  // The model is the only thing replaced. Strategy calls get a plan; creative
  // calls fall through to the stub's ad copy.
  let strategyCalls = 0;
  const strategyPrompts: string[] = [];
  const gemini = await startStubGemini({
    respond: (body) => {
      if (!body.includes('marketing strategist')) return null;
      strategyPrompts.push(body);
      strategyCalls += 1;
      // First attempt hallucinates a service. The grounding checks must catch
      // it and force a retry; only the second plan may ever be stored.
      return strategyCalls === 1 ? hallucinatedPlan() : groundedPlan();
    },
  });

  try {
    // -----------------------------------------------------------------------
    // 1. An empty salon cannot be planned for. It asks for setup, it does not
    //    invent a salon.
    // -----------------------------------------------------------------------
    const tooEarly = await createGoalAndPlan({
      goal_type: 'MORE_BOOKINGS', timeframe_days: 30, budget_amount: 800,
    });
    assert(tooEarly.ok === false && tooEarly.code === 'SALON_INCOMPLETE',
      'A goal set before the salon is described asks for setup instead of guessing');

    const noPlans = await db.query(`select count(*)::int as n from public.marketing_plans`);
    assert((noPlans.rows[0] as { n: number }).n === 0, 'Nothing was written for an unusable request');

    // -----------------------------------------------------------------------
    // 2. Owner describes the salon, then states a business goal.
    // -----------------------------------------------------------------------
    await seedSalon(db);

    const created = await createGoalAndPlan({
      goal_type: 'MORE_BOOKINGS',
      description: 'I want more bookings on quiet days.',
      target_value: 40,
      timeframe_days: 30,
      budget_amount: 800,
    });
    assert(created.ok === true, 'A goal on a described salon produces a plan');
    const planId = created.ok ? created.planId : '';

    const goalRows = await db.query(`select goal_type, status, budget_amount from public.marketing_goals where owner_id = $1`, [OWNER]);
    assert(goalRows.rows.length === 1, 'The owner\'s goal is recorded once');
    assert((goalRows.rows[0] as { status: string }).status === 'PLANNED', 'The goal is marked as planned');

    // -----------------------------------------------------------------------
    // 3. Hallucination protection, end to end.
    // -----------------------------------------------------------------------
    assert(strategyCalls === 2, 'The ungrounded first plan was rejected and regenerated');

    const planRows = await db.query(`select id, status, plan from public.marketing_plans where owner_id = $1`, [OWNER]);
    assert(planRows.rows.length === 1, 'Only one plan was stored');
    const storedPlan = (planRows.rows[0] as { plan: Record<string, unknown> }).plan;
    assert(storedPlan.recommended_service === 'Hair Spa',
      'The stored plan names a service the salon actually offers');
    assert(storedPlan.recommended_offer === OFFER.name,
      'The stored plan uses an offer that actually exists');
    assert(JSON.stringify(planRows.rows).includes('Nail Art') === false,
      'The invented service never reached the database');
    assert((planRows.rows[0] as { status: string }).status === 'DRAFT',
      'The plan waits for the owner rather than acting on itself');

    // -----------------------------------------------------------------------
    // 4. The privacy boundary held on a real call.
    // -----------------------------------------------------------------------
    const sentToModel = strategyPrompts.join('\n');
    assert(sentToModel.includes(SALON.whatsapp_number) === false, 'The salon\'s phone number was never sent to the model');
    assert(sentToModel.includes(SALON.booking_url) === false, 'The booking link was never sent to the model');
    assert(sentToModel.includes(OWNER) === false, 'The owner\'s account id was never sent to the model');
    assert(sentToModel.includes('Bridal Makeup') && sentToModel.includes('Rajajipuram'),
      'The model did receive the salon facts it is meant to reason about');

    // The retry told the model what was wrong instead of silently trying again.
    assert(strategyPrompts[1].includes('recommended_service'),
      'The second attempt was told exactly which part was wrong');

    // -----------------------------------------------------------------------
    // 5. Owner approves the plan; a campaign is created through the normal path.
    // -----------------------------------------------------------------------
    const approved = await approvePlanAndCreateCampaign(planId);
    assert(approved.ok === true, 'Approving the plan creates a campaign');
    const campaignId = approved.ok ? approved.campaignId : '';

    const campaigns = await db.query(`select * from public.unified_campaigns where owner_id = $1`, [OWNER]);
    assert(campaigns.rows.length === 1, 'Exactly one campaign was created');
    const campaign = campaigns.rows[0] as Record<string, unknown>;
    assert(campaign.service === 'Hair Spa' && campaign.offer === OFFER.name,
      'The campaign promotes what the approved plan recommended');
    assert(Number(campaign.budget_amount) === 600 && campaign.duration_days === 30,
      'The campaign carries the budget and duration from the plan');
    assert(Number(campaign.max_daily_spend) === 600 && Number(campaign.max_campaign_spend) === 18000,
      'The existing spending limits were applied to the AI-created campaign');
    assert(campaign.status === 'DRAFT', 'A newly created campaign starts as a draft, not live');
    assert(String(campaign.location).includes('Rajajipuram'), 'The plan\'s geography reached the campaign');

    const planAfter = await db.query(`select status, campaign_id from public.marketing_plans where id = $1`, [planId]);
    assert((planAfter.rows[0] as { status: string }).status === 'CONVERTED', 'The plan is marked as converted');
    assert((planAfter.rows[0] as { campaign_id: string }).campaign_id === campaignId, 'The plan points at its campaign');

    const twice = await approvePlanAndCreateCampaign(planId);
    assert(twice.ok === false, 'Approving the same plan twice does not create a second campaign');
    const stillOne = await db.query(`select count(*)::int as n from public.unified_campaigns where owner_id = $1`, [OWNER]);
    assert((stillOne.rows[0] as { n: number }).n === 1, 'Still exactly one campaign after a repeat approval');

    // -----------------------------------------------------------------------
    // 6. Creatives are generated from the approved strategy, not from nothing.
    // -----------------------------------------------------------------------
    const creativeCallsBefore = gemini.requests().length;
    const { creativeId } = await generateAndSaveGoogleCreatives(campaignId);
    assert(!!creativeId, 'Creatives were generated for the campaign');

    const creativePrompt = gemini.requests()[creativeCallsBefore];
    assert(creativePrompt.includes('Midweek calm') && creativePrompt.includes('Package value'),
      'The creative brief carried the approved plan\'s angles');
    assert(creativePrompt.includes(SALON.whatsapp_number) === false,
      'The creative brief also kept the phone number away from the model');

    const googleRows = await db.query(`select * from public.creatives_google where creative_id = $1`, [creativeId]);
    const google = googleRows.rows[0] as { headlines: any[]; descriptions: any[]; keywords: any[] };
    assert(google.headlines.length === 15, 'Fifteen headlines were produced');
    assert(google.descriptions.length === 4, 'Four descriptions were produced');
    assert(google.keywords.length === 20, 'Twenty keywords were produced');
    assert(google.headlines.every((h) => h.owner_approved === null),
      'Nothing is pre-approved: every line waits for the owner');

    // -----------------------------------------------------------------------
    // 7. The campaign cannot be approved while the copy is unreviewed.
    // -----------------------------------------------------------------------
    await db.query(
      `insert into public.integrations (owner_id, provider, status) values ($1,'google','connected')`,
      [OWNER]
    );
    // Destination reachability is a live HTTPS check with its own tests; here we
    // record the result it writes so the rest of the approval path is exercised.
    await db.query(
      `update public.unified_campaigns set destination_verification_status = 'VALID', destination_verified_at = now() where id = $1`,
      [campaignId]
    );

    const beforeReview = await verifyCampaign(campaignId);
    assert(beforeReview.allPass === false, 'Verification fails while the copy is still unreviewed');

    await db.query(`update public.unified_campaigns set status = 'PENDING_APPROVAL' where id = $1`, [campaignId]);
    let blocked = false;
    try { await approveCampaign(campaignId); } catch { blocked = true; }
    assert(blocked, 'Approval is refused while the copy is still unreviewed');
    await db.query(`update public.unified_campaigns set status = 'DRAFT' where id = $1`, [campaignId]);

    // -----------------------------------------------------------------------
    // 8. Owner reviews and approves every line, through the real review action.
    // -----------------------------------------------------------------------
    for (const type of ['headlines', 'descriptions', 'keywords'] as const) {
      for (const item of google[type]) {
        await updateGoogleCreativeItem(campaignId, creativeId, type, item.id, 'approve');
      }
    }

    const reviewed = await db.query(`select status from public.creatives where id = $1`, [creativeId]);
    assert((reviewed.rows[0] as { status: string }).status === 'APPROVED',
      'The creative is approved once the owner has approved every line');

    const afterReview = await verifyCampaign(campaignId);
    assert(afterReview.allPass === true, 'Verification passes once the copy is approved and the account is connected');

    // -----------------------------------------------------------------------
    // 9. Owner approves the campaign. It becomes ready to deploy -- and stops.
    // -----------------------------------------------------------------------
    await db.query(`update public.unified_campaigns set status = 'PENDING_APPROVAL' where id = $1`, [campaignId]);
    await approveCampaign(campaignId);

    const approvedCampaign = await db.query(`select status from public.unified_campaigns where id = $1`, [campaignId]);
    assert((approvedCampaign.rows[0] as { status: string }).status === 'READY_TO_DEPLOY',
      'The approved campaign reaches ready to deploy');

    const approvedCreative = await db.query(`select status from public.creatives where id = $1`, [creativeId]);
    assert((approvedCreative.rows[0] as { status: string }).status === 'APPROVED',
      'The approved copy is locked to the approved campaign');

    const deployments = await db.query(
      `select provider, status, external_campaign_id from public.channel_deployments where campaign_id = $1`, [campaignId]
    );
    assert(deployments.rows.length === 1, 'One deployment record exists');
    const deployment = deployments.rows[0] as { provider: string; status: string; external_campaign_id: string | null };
    assert(deployment.provider === 'google' && deployment.status === 'READY_TO_DEPLOY',
      'The campaign is ready to deploy');
    assert(deployment.external_campaign_id === null,
      'Nothing was sent to Google: approval prepares the launch, it does not perform it');

    // -----------------------------------------------------------------------
    // 10. The owner launches by hand and records the real campaign id, then
    //     real spend and real leads arrive.
    // -----------------------------------------------------------------------
    await db.query(
      `update public.channel_deployments set external_campaign_id = $2, status = 'DEPLOYED' where campaign_id = $1`,
      [campaignId, GOOGLE_CAMPAIGN_ID]
    );
    await db.query(`update public.unified_campaigns set status = 'LIVE' where id = $1`, [campaignId]);

    for (let day = 1; day <= 10; day += 1) {
      await db.query(
        `insert into public.campaign_daily_metrics
          (owner_id, campaign_id, google_campaign_id, google_campaign_name, metric_date,
           cost_micros, cost_amount, currency_code, impressions, clicks)
         values ($1,$2,$3,'Hair Spa - Search', $4, $5, $6, 'INR', $7, $8)`,
        [OWNER, campaignId, GOOGLE_CAMPAIGN_ID, `2026-06-${String(day).padStart(2, '0')}`,
          600_000_000, 600, 900, 45]
      );
    }

    // 30 leads from the campaign: 12 booked, 6 of those paid.
    for (let i = 0; i < 30; i += 1) {
      const status = i < 6 ? 'PAID' : i < 12 ? 'BOOKED' : 'NEW';
      await db.query(
        `insert into public.leads (owner_id, status, revenue_amount, gclid, attributed_google_campaign_id, attribution_checked_at)
         values ($1,$2,$3,$4,$5, now())`,
        [OWNER, status, status === 'PAID' ? 1800 : 0, `gclid-${i}`, GOOGLE_CAMPAIGN_ID]
      );
    }

    // -----------------------------------------------------------------------
    // 11. Analysis reads the figures. A campaign that is working is left alone.
    // -----------------------------------------------------------------------
    const healthy = await analyseNow();
    assert(healthy.ok === true && healthy.generated === 0,
      'A campaign that is winning bookings is not flagged as a problem');

    const noRecs = await db.query(`select count(*)::int as n from public.recommendations where owner_id = $1`, [OWNER]);
    assert((noRecs.rows[0] as { n: number }).n === 0, 'No advice is invented when there is nothing wrong');

    // A second campaign that really is wasting money.
    const wasteId = crypto.randomUUID();
    const WASTE_GOOGLE_ID = '5544332211';
    await db.query(
      `insert into public.unified_campaigns
        (id, owner_id, service, offer, budget_type, budget_amount, duration_days, max_daily_spend, max_campaign_spend,
         destination, destination_type, landing_url, destination_verification_status, channels, status)
       values ($1,$2,'Keratin Treatment','Smooth Hair Month','daily',400,30,400,12000,
               'WEBSITE','WEBSITE','https://salon-example.test/keratin','VALID', ARRAY['google'], 'LIVE')`,
      [wasteId, OWNER]
    );
    await db.query(
      `insert into public.channel_deployments (campaign_id, owner_id, provider, status, external_campaign_id)
       values ($1,$2,'google','DEPLOYED',$3)`,
      [wasteId, OWNER, WASTE_GOOGLE_ID]
    );
    for (let day = 1; day <= 10; day += 1) {
      await db.query(
        `insert into public.campaign_daily_metrics
          (owner_id, campaign_id, google_campaign_id, google_campaign_name, metric_date,
           cost_micros, cost_amount, currency_code, impressions, clicks)
         values ($1,$2,$3,'Keratin - Search', $4, $5, $6, 'INR', $7, $8)`,
        [OWNER, wasteId, WASTE_GOOGLE_ID, `2026-06-${String(day).padStart(2, '0')}`,
          400_000_000, 400, 700, 22]
      );
    }

    const analysis = await analyseNow();
    assert(analysis.ok === true && analysis.generated > 0, 'The wasteful campaign is picked up');

    const recs = await db.query(
      `select id, kind, status, confidence, evidence, campaign_id, required_action
       from public.recommendations where owner_id = $1`, [OWNER]
    );
    assert(recs.rows.length > 0, 'Recommendations were saved');
    assert(recs.rows.every((r: any) => r.status === 'OPEN'), 'Every recommendation waits for the owner');

    const waste = recs.rows.find((r: any) => r.kind === 'SPEND_NO_LEADS') as any;
    assert(!!waste, 'Spending with nothing to show for it is called out');
    assert(waste.campaign_id === wasteId,
      'The recommendation is linked back to the campaign it is about, through the id the owner pasted in');
    assert(JSON.stringify(waste.evidence).includes('4,000'),
      'The evidence quotes the real spend rather than an estimate');
    assert(recs.rows.every((r: any) => r.campaign_id !== campaignId),
      'The campaign that is working is not the subject of any warning');

    // Re-running does not stack duplicates.
    const firstCount = recs.rows.length;
    await analyseNow();
    const again = await db.query(`select count(*)::int as n from public.recommendations where owner_id = $1`, [OWNER]);
    assert((again.rows[0] as { n: number }).n === firstCount, 'Re-running the analysis refreshes rather than duplicates');

    // -----------------------------------------------------------------------
    // 12. Approving a recommendation records intent and nothing else.
    // -----------------------------------------------------------------------
    const budgetBefore = await db.query(
      `select budget_amount, max_daily_spend, max_campaign_spend, status from public.unified_campaigns where id = $1`, [wasteId]
    );
    const target = waste as { id: string };
    const decision = await decideRecommendation(target.id, 'APPROVED');
    assert(decision.ok === true, 'The owner can approve a recommendation');

    const budgetAfter = await db.query(
      `select budget_amount, max_daily_spend, max_campaign_spend, status from public.unified_campaigns where id = $1`, [wasteId]
    );
    assert(JSON.stringify(budgetBefore.rows) === JSON.stringify(budgetAfter.rows),
      'Approving a recommendation changed no budget and launched nothing');

    const decided = await db.query(`select status, decided_at from public.recommendations where id = $1`, [target.id]);
    assert((decided.rows[0] as { status: string }).status === 'APPROVED', 'The decision is recorded');

    const reDecide = await decideRecommendation(target.id, 'DISMISSED');
    assert(reDecide.ok === false, 'A decided recommendation cannot be silently overwritten');

    // -----------------------------------------------------------------------
    // 13. The loop is observable, without storing anything the model said.
    // -----------------------------------------------------------------------
    const events = await db.query(`select event_type, success, metadata from public.ai_events where owner_id = $1`, [OWNER]);
    const kinds = events.rows.map((e: any) => e.event_type);
    for (const expected of ['STRATEGY_GENERATED', 'PLAN_CONVERTED_TO_CAMPAIGN', 'ANALYSIS_RUN', 'RECOMMENDATION_APPROVED']) {
      assert(kinds.includes(expected), `The loop recorded that ${expected.toLowerCase().replace(/_/g, ' ')} happened`);
    }

    const eventText = JSON.stringify(events.rows);
    assert(eventText.includes('Midweek calm') === false && eventText.includes('Hair Spa') === false,
      'The activity log holds counts and outcomes, never the text the model produced');

    const strategyEvent = events.rows.find((e: any) => e.event_type === 'STRATEGY_GENERATED') as any;
    assert(strategyEvent.metadata.attempts === 2, 'The log shows the strategy needed a second attempt');

    // -----------------------------------------------------------------------
    // 14. The audit trail names the owner as the actor for every decision.
    // -----------------------------------------------------------------------
    const audits = await db.query(`select action, actor, owner_id from public.audit_logs where owner_id = $1`, [OWNER]);
    const actions = audits.rows.map((a: any) => a.action);
    assert(actions.includes('MARKETING_PLAN_APPROVED'), 'Plan approval is in the audit trail');
    assert(actions.includes('RECOMMENDATION_APPROVED'), 'The recommendation decision is in the audit trail');
    assert(actions.includes('CAMPAIGN_APPROVED'), 'Campaign approval is in the audit trail');
    assert(audits.rows.filter((a: any) => a.actor !== null).every((a: any) => a.actor === OWNER),
      'Every recorded decision is attributed to the owner');
    assert(audits.rows.every((a: any) => a.owner_id === OWNER), 'The audit trail belongs to this owner alone');
  } finally {
    await gemini.close();
    __setMockCreateClient(null);
    await db.close();
  }

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
