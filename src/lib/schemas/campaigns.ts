import { z } from 'zod';

export const CampaignIntentSchema = z.object({
  service: z.string().min(2, "Service is required"),
  offer: z.string().min(2, "Offer is required"),
  budget_type: z.enum(['daily', 'total']),
  budget_amount: z.number().positive("Budget must be greater than 0"),
  duration_days: z.number().int().min(1, "Duration must be at least 1 day").max(365, "Duration too long"),
  destination: z.string().min(1, "Destination is required"),
  channels: z.array(z.string()).min(1, "At least one channel is required"),
  creative_id: z.string().optional()
});
