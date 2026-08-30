import crypto from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';

export const LOGIN_THROTTLE = {
  windowMs: 15 * 60 * 1000,
  maxAttempts: 8,
  lockMs: 15 * 60 * 1000,
} as const;

export type ThrottleRow = {
  attempt_count: number;
  window_started_at: string;
  locked_until: string | null;
};

export function hashLoginEmail(email: string): string {
  return crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

export function isLoginLocked(row: ThrottleRow | null, now: number = Date.now()): boolean {
  if (!row?.locked_until) return false;
  const until = Date.parse(row.locked_until);
  return Number.isFinite(until) && until > now;
}

export function nextFailureState(row: ThrottleRow | null, now: number = Date.now()): ThrottleRow {
  const windowStart = row ? Date.parse(row.window_started_at) : NaN;
  const inWindow = Boolean(row && Number.isFinite(windowStart) && now - windowStart < LOGIN_THROTTLE.windowMs);
  const attempt_count = inWindow && row ? row.attempt_count + 1 : 1;
  const window_started_at = inWindow && row ? row.window_started_at : new Date(now).toISOString();
  const locked_until =
    attempt_count >= LOGIN_THROTTLE.maxAttempts
      ? new Date(now + LOGIN_THROTTLE.lockMs).toISOString()
      : null;
  return { attempt_count, window_started_at, locked_until };
}

async function readRow(emailHash: string): Promise<ThrottleRow | null> {
  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from('login_throttle')
      .select('attempt_count, window_started_at, locked_until')
      .eq('email_hash', emailHash)
      .single();
    if (error || !data) return null;
    return data as ThrottleRow;
  } catch {
    return null;
  }
}

export async function loginIsThrottled(email: string): Promise<boolean> {
  return isLoginLocked(await readRow(hashLoginEmail(email)));
}

export async function recordLoginFailure(email: string): Promise<void> {
  try {
    const db = createServiceClient();
    const hash = hashLoginEmail(email);
    const { error } = await db.rpc('rpc_record_login_failure', { p_email_hash: hash });
    if (!error) return;
    // Fallback when the RPC is not deployed yet (older DBs / some tests).
    const next = nextFailureState(await readRow(hash));
    await db.from('login_throttle').upsert({
      email_hash: hash,
      attempt_count: next.attempt_count,
      window_started_at: next.window_started_at,
      locked_until: next.locked_until,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email_hash' });
  } catch {
    // Missing service role or table must not brick login.
  }
}

export async function clearLoginThrottle(email: string): Promise<void> {
  try {
    const db = createServiceClient();
    await db.from('login_throttle').delete().eq('email_hash', hashLoginEmail(email));
  } catch {
    // Same as recordLoginFailure: observability, not a login dependency.
  }
}
