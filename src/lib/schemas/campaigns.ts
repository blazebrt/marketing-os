import { z } from 'zod';
import { DESTINATION_TYPES } from '@/lib/campaigns/destination';

export const CampaignIntentSchema = z.object({
  service: z.string().min(2, 'Service is required'),
  offer: z.string().min(2, 'Offer is required'),
  budget_type: z.enum(['daily', 'total']),
  budget_amount: z.number().positive('Budget must be greater than 0'),
  duration_days: z.number().int().min(1, 'Duration must be at least 1 day').max(365, 'Duration too long'),
  destination_type: z.enum(DESTINATION_TYPES),
  landing_url: z.string().optional().nullable(),
  destination: z.string().min(1).optional(),
  target_audience: z.string().max(200, 'Target audience is too long').optional().nullable(),
  location: z.string().max(200, 'Location is too long').optional().nullable(),
  channels: z.array(z.string().trim().min(1))
    .min(1, 'At least one channel is required')
    .transform((channels) => [...new Set(channels.map((c) => c.toLowerCase()))])
    .refine(
      (channels) => channels.every((c) => ['google', 'meta', 'whatsapp', 'instagram', 'website'].includes(c)),
      'Unsupported advertising channel'
    ),
  creative_id: z.string().optional(),
});
