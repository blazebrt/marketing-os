import { z } from 'zod';

export const InteractionSchema = z.object({
  session_id: z.string().min(1),
  interaction_type: z.enum(['website_visit', 'whatsapp_click', 'phone_click', 'lead_form_start']),
  source: z.string().optional(),
  campaign_name: z.string().optional(),
  ad_group_name: z.string().optional(),
  ad_name: z.string().optional(),
  creative_id: z.string().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  fbclid: z.string().optional(),
  gclid: z.string().optional(),
  landing_page: z.string().optional()
});

export const LeadIngestionSchema = z.object({
  session_id: z.string().optional(),
  external_lead_id: z.string().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  source: z.string().optional(),
  // Strict sanitization: Webhooks CANNOT provide status or revenue
}).refine(data => data.phone || data.email || data.external_lead_id, {
  message: 'Lead must contain phone, email, or external_lead_id'
});
