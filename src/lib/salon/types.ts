export type SalonProfile = {
  id?: string;
  salon_name: string | null;
  description: string | null;
  location: string | null;
  service_areas: string[];
  website_url: string | null;
  booking_url: string | null;
  whatsapp_number: string | null;
  target_customer_types: string[];
  unique_selling_points: string[];
  brand_positioning: string | null;
  preferred_tone: string | null;
  slow_days: string[];
  busy_days: string[];
  default_destination_type: 'WEBSITE' | 'WHATSAPP' | 'PHONE';
  currency: string;
};

export type SalonService = {
  id: string;
  name: string;
  category: string | null;
  price: number | null;
  duration_minutes: number | null;
  margin_tier: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  notes: string | null;
  is_active: boolean;
};

export type SalonOffer = {
  id: string;
  service_id: string | null;
  name: string;
  description: string | null;
  price: number | null;
  terms: string | null;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
};

export type SalonContext = {
  profile: SalonProfile | null;
  services: SalonService[];
  offers: SalonOffer[];
};

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/**
 * What the strategist needs before it can produce anything worth reading.
 * Reported to the owner as setup steps, never worked around by inventing data.
 */
export function salonContextGaps(context: SalonContext): string[] {
  const gaps: string[] = [];
  if (!context.profile?.salon_name?.trim()) gaps.push('Salon name');
  if (!context.profile?.location?.trim()) gaps.push('Location');
  if (context.services.filter((s) => s.is_active).length === 0) gaps.push('At least one service');
  return gaps;
}

export function isSalonReadyForStrategy(context: SalonContext): boolean {
  return salonContextGaps(context).length === 0;
}
