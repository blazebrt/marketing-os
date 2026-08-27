import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { refreshAllConnectedAccounts } from '@/lib/metrics/sync';
import { logSafeError } from '@/lib/errors';

/**
 * Nightly refresh of yesterday's Google Ads metrics for every connected
 * account. Read-only against Google; writes only to our own tables.
 *
 * Protected by CRON_SECRET. Vercel Cron sends it as "Authorization: Bearer
 * <secret>", which is what this checks. Without the secret set the route
 * refuses every request rather than running unprotected.
 *
 * Safe to run twice: metrics upsert on (owner, google campaign, date), and
 * attribution only fills leads that have no answer yet.
 */

export const dynamic = 'force-dynamic';
// Pulling several accounts and a click report can exceed the default limit.
export const maxDuration = 300;

/** Constant-time compare, so a wrong secret leaks nothing through timing. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  // Fail closed: an unset secret means the route is not callable at all.
  if (!expected) return false;

  const header = req.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (bearer && secretMatches(bearer, expected)) return true;

  // Vercel Cron uses the Authorization header; this is for manual curl runs.
  const headerSecret = req.headers.get('x-cron-secret') || '';
  return !!headerSecret && secretMatches(headerSecret, expected);
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    // Same response whether the secret is wrong or simply not configured.
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ?date=YYYY-MM-DD re-runs a specific day; omitted means yesterday.
  const requested = req.nextUrl.searchParams.get('date') || undefined;
  if (requested && !/^\d{4}-\d{2}-\d{2}$/.test(requested)) {
    return NextResponse.json({ error: 'invalid_date' }, { status: 400 });
  }

  try {
    const summary = await refreshAllConnectedAccounts(requested);

    // Per-owner detail without owner ids, which do not belong in cron logs.
    const failures = summary.owners.filter((o) => o.error).map((o) => o.error);
    return NextResponse.json({
      ok: true,
      date: summary.date,
      accounts: summary.ownersProcessed,
      metric_rows: summary.owners.reduce((n, o) => n + o.metricRows, 0),
      campaigns_linked: summary.owners.reduce((n, o) => n + o.campaignsLinked, 0),
      leads_attributed: summary.owners.reduce((n, o) => n + o.leadsAttributed, 0),
      leads_untraceable: summary.owners.reduce((n, o) => n + o.leadsUnresolved, 0),
      failures,
    });
  } catch (err) {
    logSafeError('cron.refresh-metrics', err);
    return NextResponse.json({ error: 'refresh_failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
