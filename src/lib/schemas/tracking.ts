import { z } from 'zod';

const bounded = (max: number) => z.string().trim().min(1).max(max);

export const InteractionSchema = z.object({
  session_id: bounded(128),
  interaction_type: z.enum(['website_visit', 'whatsapp_click', 'phone_click', 'lead_form_start']),
  source: bounded(80).optional(),
  campaign_name: bounded(200).optional(),
  ad_group_name: bounded(200).optional(),
  ad_name: bounded(200).optional(),
  creative_id: bounded(80).optional(),
  utm_source: bounded(80).optional(),
  utm_medium: bounded(80).optional(),
  utm_campaign: bounded(200).optional(),
  fbclid: bounded(200).optional(),
  gclid: bounded(200).optional(),
  landing_page: bounded(2000).optional(),
});

export const LeadIngestionSchema = z.object({
  session_id: z.string().trim().max(128).optional(),
  external_lead_id: z.string().trim().max(128).optional(),
  name: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(32).optional(),
  email: z.string().email().max(320).optional().or(z.literal('')),
  source: z.string().trim().max(80).optional(),
}).refine(data => data.phone || data.email || data.external_lead_id, {
  message: 'Lead must contain phone, email, or external_lead_id'
});
