import { lookup as dnsLookup } from 'node:dns/promises';
import { classifyAddress, parseLiteralIP } from '@/lib/net/ip';
import { AppError, ERROR_CODES } from '@/lib/errors';

export const URL_VALIDATION = {
  TIMEOUT_MS: 3000,
  MAX_REDIRECTS: 3,
  MAX_RESPONSE_BYTES: 16384,
  METHOD: 'HEAD' as const,
};

const METADATA_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata',
  'instance-data',
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
]);

export type DnsAnswer = { address: string; family: number };

export type UrlValidatorDeps = {
  lookup?: (hostname: string) => Promise<DnsAnswer[]>;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
};

export type UrlValidationResult = { valid: boolean; error?: string; code?: string };

function normalizeHostname(hostname: string): string {
  let h = hostname.trim().toLowerCase();
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  return h;
}

function isBlockedMetadataHostname(hostname: string): boolean {
  return METADATA_HOSTNAMES.has(normalizeHostname(hostname));
}

async function defaultLookup(hostname: string): Promise<DnsAnswer[]> {
  try {
    const results = await dnsLookup(hostname, { all: true, verbatim: true });
    return results.map((r) => ({ address: r.address, family: r.family }));
  } catch {
    throw new AppError(ERROR_CODES.DESTINATION_INVALID);
  }
}

export async function resolveAndAuthorizeHost(
  hostname: string,
  deps: UrlValidatorDeps = {}
): Promise<{ hostname: string; addresses: string[] }> {
  const host = normalizeHostname(hostname);
  if (!host) throw new AppError(ERROR_CODES.DESTINATION_INVALID);
  if (isBlockedMetadataHostname(host)) throw new AppError(ERROR_CODES.DESTINATION_INVALID);

  const literal = parseLiteralIP(host);
  if (literal) {
    if (classifyAddress(literal) !== 'public') {
      throw new AppError(ERROR_CODES.DESTINATION_INVALID);
    }
    return { hostname: host, addresses: [literal] };
  }

  const lookup = deps.lookup || defaultLookup;
  let answers: DnsAnswer[];
  try {
    answers = await lookup(host);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(ERROR_CODES.DESTINATION_INVALID);
  }

  if (!answers || answers.length === 0) {
    throw new AppError(ERROR_CODES.DESTINATION_INVALID);
  }

  const addresses = answers.map((a) => a.address);
  const classes = addresses.map((a) => classifyAddress(a));
  if (classes.some((c) => c === 'invalid')) {
    throw new AppError(ERROR_CODES.DESTINATION_INVALID);
  }
  if (classes.some((c) => c === 'blocked')) {
    throw new AppError(ERROR_CODES.DESTINATION_INVALID);
  }
  if (classes.some((c) => c !== 'public')) {
    throw new AppError(ERROR_CODES.DESTINATION_INVALID);
  }

  return { hostname: host, addresses };
}

export function parseDestinationUrl(urlStr: string, requireHttps = true): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new AppError(ERROR_CODES.DESTINATION_INVALID);
  }

  if (requireHttps) {
    if (parsed.protocol !== 'https:') throw new AppError(ERROR_CODES.DESTINATION_INVALID);
  } else if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AppError(ERROR_CODES.DESTINATION_INVALID);
  }

  if (parsed.username || parsed.password) {
    throw new AppError(ERROR_CODES.DESTINATION_INVALID);
  }

  if (!parsed.hostname) throw new AppError(ERROR_CODES.DESTINATION_INVALID);
  return parsed;
}

function redirectLocation(current: URL, response: Response): URL | null {
  const status = response.status;
  if (![301, 302, 303, 307, 308].includes(status)) return null;
  const loc = response.headers.get('location');
  if (!loc) throw new AppError(ERROR_CODES.DESTINATION_INVALID);
  try {
    return new URL(loc, current);
  } catch {
    throw new AppError(ERROR_CODES.DESTINATION_INVALID);
  }
}

async function pinnedFetch(
  url: URL,
  addresses: string[],
  deps: UrlValidatorDeps
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), URL_VALIDATION.TIMEOUT_MS);

  const init: RequestInit = {
    method: URL_VALIDATION.METHOD,
    redirect: 'manual',
    signal: controller.signal,
    headers: {
      'User-Agent': 'Marketing-OS-Validator/1.0',
    },
  };

  try {
    if (deps.fetchImpl) {
      return await deps.fetchImpl(url.toString(), init);
    }

    try {
      const undici = await import('undici');
      const dispatcher = new undici.Agent({
        connectTimeout: URL_VALIDATION.TIMEOUT_MS,
        headersTimeout: URL_VALIDATION.TIMEOUT_MS,
        bodyTimeout: URL_VALIDATION.TIMEOUT_MS,
        connect: {
          lookup: (hostname: string, _opts: unknown, cb: (err: Error | null, address: string, family: number) => void) => {
            if (normalizeHostname(hostname) !== normalizeHostname(url.hostname)) {
              cb(new Error('lookup hostname mismatch'), '', 4);
              return;
            }
            const address = addresses[0];
            const family = address.includes(':') ? 6 : 4;
            cb(null, address, family);
          },
        },
      });
      return (await undici.fetch(url.toString(), {
        ...init,
        dispatcher,
        maxRedirections: 0,
      } as any)) as unknown as Response;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(ERROR_CODES.DESTINATION_UNREACHABLE);
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(ERROR_CODES.DESTINATION_UNREACHABLE);
  } finally {
    clearTimeout(timeout);
  }
}

async function enforceResponseSize(response: Response): Promise<void> {
  const len = response.headers.get('content-length');
  if (len && Number(len) > URL_VALIDATION.MAX_RESPONSE_BYTES) {
    throw new AppError(ERROR_CODES.DESTINATION_UNREACHABLE);
  }
  try {
    const reader = response.body?.getReader();
    if (!reader) return;
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value?.byteLength || 0;
      if (total > URL_VALIDATION.MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new AppError(ERROR_CODES.DESTINATION_UNREACHABLE);
      }
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(ERROR_CODES.DESTINATION_UNREACHABLE);
  }
}

/**
 * SSRF-safe destination validator.
 * Resolves DNS, classifies every IP, fetches HEAD with redirects disabled,
 * and re-validates each redirect hop independently.
 */
export async function validateDestinationUrl(
  urlStr: string,
  deps: UrlValidatorDeps = {}
): Promise<UrlValidationResult> {
  try {
    let current = parseDestinationUrl(urlStr, true);
    let hops = 0;

    while (true) {
      const resolved = await resolveAndAuthorizeHost(current.hostname, deps);
      const response = await pinnedFetch(current, resolved.addresses, deps);
      await enforceResponseSize(response);

      const next = redirectLocation(current, response);
      if (!next) {
        if (response.status >= 200 && response.status < 400) {
          return { valid: true };
        }
        if (response.status === 405) {
          return { valid: true };
        }
        return { valid: false, error: 'DESTINATION_UNREACHABLE', code: ERROR_CODES.DESTINATION_UNREACHABLE };
      }

      hops += 1;
      if (hops > URL_VALIDATION.MAX_REDIRECTS) {
        return { valid: false, error: 'DESTINATION_INVALID', code: ERROR_CODES.DESTINATION_INVALID };
      }

      if (next.protocol !== 'https:') {
        return { valid: false, error: 'DESTINATION_INVALID', code: ERROR_CODES.DESTINATION_INVALID };
      }
      if (next.username || next.password) {
        return { valid: false, error: 'DESTINATION_INVALID', code: ERROR_CODES.DESTINATION_INVALID };
      }

      current = parseDestinationUrl(next.toString(), true);
    }
  } catch (err) {
    if (err instanceof AppError) {
      return { valid: false, error: err.code, code: err.code };
    }
    return { valid: false, error: 'DESTINATION_INVALID', code: ERROR_CODES.DESTINATION_INVALID };
  }
}

/** Parse-only check used on page render — no DNS, no HTTP. */
export function validateDestinationUrlSyntax(urlStr: string): UrlValidationResult {
  try {
    parseDestinationUrl(urlStr, true);
    const host = normalizeHostname(new URL(urlStr).hostname);
    if (isBlockedMetadataHostname(host)) {
      return { valid: false, error: 'DESTINATION_INVALID', code: ERROR_CODES.DESTINATION_INVALID };
    }
    const literal = parseLiteralIP(host);
    if (literal && classifyAddress(literal) !== 'public') {
      return { valid: false, error: 'DESTINATION_INVALID', code: ERROR_CODES.DESTINATION_INVALID };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'DESTINATION_INVALID', code: ERROR_CODES.DESTINATION_INVALID };
  }
}
