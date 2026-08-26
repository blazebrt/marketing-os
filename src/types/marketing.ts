export const LEAD_STATUSES = ['new', 'contacted', 'booked', 'visited', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_DESTINATIONS = ['lead_form', 'whatsapp', 'website'] as const;
export type LeadDestination = (typeof LEAD_DESTINATIONS)[number];

export type CampaignDraft = {
  name: string;
  service: string;
  offer: string;
  daily_budget: number;
  duration_days: number;
  creative_mode: 'existing' | 'generate';
  destination: LeadDestination;
};
