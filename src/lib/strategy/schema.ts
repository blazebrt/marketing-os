import { z } from 'zod';

/**
 * The MarketingPlan contract.
 *
 * Model output is never trusted. It is parsed by this schema and then checked
 * for grounding (see grounding.ts) before it can be stored or shown.
 */

export const EVIDENCE_KINDS = ['FACT', 'INFERENCE', 'RECOMMENDATION'] as const;

/**
 * Every claim the plan makes is labelled, so the owner can tell the difference
 * between something measured, something reasoned, and something suggested.
 */
export const ClaimSchema = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  statement: z.string().trim().min(3).max(400),
  /** Required for FACT: what in the data supports it. */
  evidence: z.string().trim().max(400).optional().nullable(),
});

export const CreativeAngleSchema = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().min(10).max(400),
});

export const MarketingPlanSchema = z.object({
  objective: z.string().trim().min(10).max(400),
  primary_kpi: z.enum(['BOOKINGS', 'LEADS', 'NEW_CUSTOMERS', 'REVENUE']),

  recommended_service: z.string().trim().min(1).max(120),
  recommended_offer: z.string().trim().max(200).optional().nullable(),
  why_this_service: z.string().trim().min(10).max(600),

  target_audience: z.string().trim().min(5).max(300),
  geography: z.string().trim().min(2).max(200),

  channels: z.array(z.enum(['google'])).min(1).max(1),

  budget: z.object({
    daily_amount: z.number().positive().max(50_000),
    duration_days: z.number().int().min(1).max(365),
  }),

  destination: z.object({
    type: z.enum(['WEBSITE', 'WHATSAPP', 'PHONE']),
    rationale: z.string().trim().min(5).max(300),
  }),

  messaging_strategy: z.string().trim().min(20).max(1000),
  creative_angles: z.array(CreativeAngleSchema).min(2).max(6),

  measurement_plan: z.string().trim().min(10).max(600),
  assumptions: z.array(z.string().trim().min(5).max(300)).max(8).default([]),
  risks: z.array(z.string().trim().min(5).max(300)).max(8).default([]),
  claims: z.array(ClaimSchema).min(1).max(12),
});

export type MarketingPlan = z.infer<typeof MarketingPlanSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type CreativeAngle = z.infer<typeof CreativeAngleSchema>;

/** Gemini responseSchema mirroring the zod contract above. */
export const MARKETING_PLAN_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    objective: { type: 'STRING' },
    primary_kpi: { type: 'STRING', enum: ['BOOKINGS', 'LEADS', 'NEW_CUSTOMERS', 'REVENUE'] },
    recommended_service: { type: 'STRING' },
    recommended_offer: { type: 'STRING' },
    why_this_service: { type: 'STRING' },
    target_audience: { type: 'STRING' },
    geography: { type: 'STRING' },
    channels: { type: 'ARRAY', items: { type: 'STRING', enum: ['google'] } },
    budget: {
      type: 'OBJECT',
      properties: {
        daily_amount: { type: 'NUMBER' },
        duration_days: { type: 'INTEGER' },
      },
      required: ['daily_amount', 'duration_days'],
    },
    destination: {
      type: 'OBJECT',
      properties: {
        type: { type: 'STRING', enum: ['WEBSITE', 'WHATSAPP', 'PHONE'] },
        rationale: { type: 'STRING' },
      },
      required: ['type', 'rationale'],
    },
    messaging_strategy: { type: 'STRING' },
    creative_angles: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, description: { type: 'STRING' } },
        required: ['name', 'description'],
      },
    },
    measurement_plan: { type: 'STRING' },
    assumptions: { type: 'ARRAY', items: { type: 'STRING' } },
    risks: { type: 'ARRAY', items: { type: 'STRING' } },
    claims: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          kind: { type: 'STRING', enum: ['FACT', 'INFERENCE', 'RECOMMENDATION'] },
          statement: { type: 'STRING' },
          evidence: { type: 'STRING' },
        },
        required: ['kind', 'statement'],
      },
    },
  },
  required: [
    'objective', 'primary_kpi', 'recommended_service', 'why_this_service',
    'target_audience', 'geography', 'channels', 'budget', 'destination',
    'messaging_strategy', 'creative_angles', 'measurement_plan', 'claims',
  ],
};
