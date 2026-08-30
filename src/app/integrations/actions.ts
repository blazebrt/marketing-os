'use server';

import { createClient } from '@/lib/supabase/server';
import { upsertIntegration } from '@/lib/integrations';
import { AppError, ERROR_CODES, logSafeError, toSafeError } from '@/lib/errors';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // No Next store in unit tests.
  }
}

/**
 * Creates (or rotates) the website tracking HMAC.
 *
 * The plaintext secret is returned once to the owner so they can put it on
 * the salon site. It is stored only encrypted. Rotating invalidates the old
 * secret immediately.
 */
export async function provisionWebsiteTracking(): Promise<
  { ok: true; integrationId: string; hmacSecret: string } | { ok: false; code: string }
> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new AppError(ERROR_CODES.UNAUTHORIZED, 401);

    const hmacSecret = crypto.randomBytes(32).toString('hex');
    await upsertIntegration(user.id, 'website', { hmac_secret: hmacSecret }, 'connected');

    const { data: row, error } = await supabase
      .from('integrations')
      .select('id')
      .eq('owner_id', user.id)
      .eq('provider', 'website')
      .single();

    if (error || !row?.id) {
      logSafeError('provisionWebsiteTracking', error);
      throw new AppError(ERROR_CODES.GENERATION_FAILED, 500);
    }

    safeRevalidate('/integrations');
    return { ok: true, integrationId: row.id as string, hmacSecret };
  } catch (err) {
    logSafeError('provisionWebsiteTracking', err);
    return { ok: false, code: toSafeError(err).code };
  }
}
