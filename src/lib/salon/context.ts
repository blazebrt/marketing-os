import { createClient } from '@/lib/supabase/server';
import type { SalonContext, SalonProfile, SalonService, SalonOffer } from './types';

/**
 * Loads everything the AI is allowed to know about the salon.
 * RLS scopes every read to the signed-in owner.
 */
export async function loadSalonContext(ownerId: string): Promise<SalonContext> {
  const supabase = await createClient();

  const [{ data: profile }, { data: services }, { data: offers }] = await Promise.all([
    supabase.from('salon_profile').select('*').eq('owner_id', ownerId).maybeSingle(),
    supabase.from('salon_services').select('*').eq('owner_id', ownerId).order('name'),
    supabase.from('salon_offers').select('*').eq('owner_id', ownerId).order('name'),
  ]);

  return {
    profile: (profile as SalonProfile) ?? null,
    services: (services ?? []) as SalonService[],
    offers: (offers ?? []) as SalonOffer[],
  };
}
