'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { AppError, ERROR_CODES, logSafeError, toSafeError } from '@/lib/errors';
import { SalonProfileSchema, SalonServiceSchema, SalonOfferSchema } from '@/lib/salon/schemas';

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // No Next store outside a request.
  }
}

async function requireOwner() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);
  return { supabase, ownerId: user.id };
}

function refresh() {
  safeRevalidate('/salon');
  safeRevalidate('/');
  safeRevalidate('/goals');
}

export async function saveSalonProfile(raw: unknown) {
  try {
    const { supabase, ownerId } = await requireOwner();
    const parsed = SalonProfileSchema.parse(raw);

    const { error } = await supabase
      .from('salon_profile')
      .upsert({ owner_id: ownerId, ...parsed, updated_at: new Date().toISOString() }, { onConflict: 'owner_id' });

    if (error) {
      logSafeError('saveSalonProfile', error);
      throw new AppError(ERROR_CODES.GENERATION_FAILED, 500);
    }
    refresh();
    return { ok: true as const };
  } catch (err) {
    logSafeError('saveSalonProfile', err);
    return { ok: false as const, code: toSafeError(err).code };
  }
}

export async function saveService(raw: unknown, serviceId?: string) {
  try {
    const { supabase, ownerId } = await requireOwner();
    const parsed = SalonServiceSchema.parse(raw);
    const row = { owner_id: ownerId, ...parsed, updated_at: new Date().toISOString() };

    const { error } = serviceId
      ? await supabase.from('salon_services').update(row).eq('id', serviceId).eq('owner_id', ownerId)
      : await supabase.from('salon_services').upsert(row, { onConflict: 'owner_id,name' });

    if (error) {
      logSafeError('saveService', error);
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400);
    }
    refresh();
    return { ok: true as const };
  } catch (err) {
    logSafeError('saveService', err);
    return { ok: false as const, code: toSafeError(err).code };
  }
}

export async function deleteService(serviceId: string) {
  try {
    const { supabase, ownerId } = await requireOwner();
    const { error } = await supabase.from('salon_services').delete().eq('id', serviceId).eq('owner_id', ownerId);
    if (error) throw new AppError(ERROR_CODES.GENERATION_FAILED, 500);
    refresh();
    return { ok: true as const };
  } catch (err) {
    logSafeError('deleteService', err);
    return { ok: false as const, code: toSafeError(err).code };
  }
}

export async function saveOffer(raw: unknown, offerId?: string) {
  try {
    const { supabase, ownerId } = await requireOwner();
    const parsed = SalonOfferSchema.parse(raw);
    const row = { owner_id: ownerId, ...parsed, updated_at: new Date().toISOString() };

    const { error } = offerId
      ? await supabase.from('salon_offers').update(row).eq('id', offerId).eq('owner_id', ownerId)
      : await supabase.from('salon_offers').upsert(row, { onConflict: 'owner_id,name' });

    if (error) {
      logSafeError('saveOffer', error);
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400);
    }
    refresh();
    return { ok: true as const };
  } catch (err) {
    logSafeError('saveOffer', err);
    return { ok: false as const, code: toSafeError(err).code };
  }
}

export async function deleteOffer(offerId: string) {
  try {
    const { supabase, ownerId } = await requireOwner();
    const { error } = await supabase.from('salon_offers').delete().eq('id', offerId).eq('owner_id', ownerId);
    if (error) throw new AppError(ERROR_CODES.GENERATION_FAILED, 500);
    refresh();
    return { ok: true as const };
  } catch (err) {
    logSafeError('deleteOffer', err);
    return { ok: false as const, code: toSafeError(err).code };
  }
}
