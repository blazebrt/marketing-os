import { z } from 'zod';

const trimmedOptional = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

const stringList = (maxItems: number, maxLen: number) =>
  z.array(z.string().trim().min(1).max(maxLen)).max(maxItems).default([]);

export const SalonProfileSchema = z.object({
  salon_name: trimmedOptional(120),
  description: trimmedOptional(1000),
  location: trimmedOptional(200),
  service_areas: stringList(20, 120),
  website_url: trimmedOptional(500),
  booking_url: trimmedOptional(500),
  whatsapp_number: trimmedOptional(30),
  target_customer_types: stringList(20, 120),
  unique_selling_points: stringList(20, 200),
  brand_positioning: trimmedOptional(300),
  preferred_tone: trimmedOptional(120),
  slow_days: stringList(7, 20),
  busy_days: stringList(7, 20),
  default_destination_type: z.enum(['WEBSITE', 'WHATSAPP', 'PHONE']).default('WEBSITE'),
  currency: z.string().trim().length(3).default('INR'),
});

export const SalonServiceSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  category: trimmedOptional(80),
  price: z.number().nonnegative().max(10_000_000).optional().nullable(),
  duration_minutes: z.number().int().positive().max(1440).optional().nullable(),
  margin_tier: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional().nullable(),
  notes: trimmedOptional(500),
  is_active: z.boolean().default(true),
});

export const SalonOfferSchema = z.object({
  service_id: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(2, 'Name is required').max(120),
  description: trimmedOptional(500),
  price: z.number().nonnegative().max(10_000_000).optional().nullable(),
  terms: trimmedOptional(500),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  is_active: z.boolean().default(true),
});

export type SalonProfileInput = z.infer<typeof SalonProfileSchema>;
export type SalonServiceInput = z.infer<typeof SalonServiceSchema>;
export type SalonOfferInput = z.infer<typeof SalonOfferSchema>;
