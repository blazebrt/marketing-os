// TEST ENVIRONMENT BOOTSTRAP
//
// Two jobs, in this order:
//   1. Supply deterministic placeholder configuration, so the suite runs on a
//      clean checkout. Real secrets live in .env.local, which is gitignored and
//      therefore absent on CI and on a fresh clone.
//   2. Enforce the hard safety guard below, which is unchanged.

import { config as loadDotenv } from 'dotenv';

// Load real local configuration first, so a developer's .env.local always wins
// over the placeholders below. Tests that call dotenv themselves afterwards are
// then a harmless no-op. Missing file is fine -- dotenv reports, never throws.
loadDotenv({ path: '.env.local' });

// Only fills gaps: a value already supplied by .env.local or the real
// environment is never overwritten, so the safety guard still sees it.
const TEST_ENV_DEFAULTS: Record<string, string> = {
  // Must decode to exactly 32 bytes. Obviously fake, test-only.
  ENCRYPTION_KEY: Buffer.alloc(32, 'marketing-os-test-key').toString('base64'),

  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',

  GOOGLE_ADS_DEVELOPER_TOKEN: 'test-developer-token',
  GOOGLE_ADS_TEST_CUSTOMER_ID: '123-456-7890',
  GOOGLE_ADS_TEST_MANAGER_ID: '123-456-7890',
};

// Deliberately NOT defaulted:
//   * GOOGLE_ADS_EXECUTION_MODE, GOOGLE_ADS_ALLOW_MUTATIONS and
//     GOOGLE_ADS_DEPLOYMENT_CONFIRMATION are the kill switches guarding real
//     Google Ads mutations. They must stay unset so the gate keeps failing
//     closed; tests that need them set them explicitly.
//   * The Supabase URL and keys. safety_guard.test.ts relies on the URL being
//     absent so it falls back to a production hostname and proves the fetch
//     interceptor below blocks it. Defaulting the URL would silently disarm
//     that test.
for (const [key, value] of Object.entries(TEST_ENV_DEFAULTS)) {
  if (!process.env[key]) process.env[key] = value;
}

// HARD SAFETY GUARD
// Ensure tests NEVER connect to a production/remote Supabase environment.

const isTestEnv = process.env.NODE_ENV === 'test' || process.argv.some(a => a.includes('test') || a.includes('jest') || a.includes('mocha'));

if (isTestEnv) {
  // 1. Check environment variables
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  if (url && !url.includes('127.0.0.1') && !url.includes('localhost') && !url.includes('mock')) {
    console.error(`\n[CRITICAL ERROR] HARD SAFETY GUARD TRIGGERED!`);
    console.error(`Automated tests MUST use an isolated test database (e.g., PGLite, localhost, or mock).`);
    console.error(`Remote database detected in environment: ${url}`);
    process.exit(1);
  }

  // 2. Intercept all outgoing fetch requests as a secondary failsafe
  const originalFetch = global.fetch;
  global.fetch = async (...args: any[]) => {
    const fetchUrl = args[0]?.toString() || '';
    if (fetchUrl.includes('supabase.co')) {
       console.error(`\n[CRITICAL ERROR] HARD SAFETY GUARD TRIGGERED!`);
       console.error(`Intercepted network request to production Supabase: ${fetchUrl}`);
       console.error(`Tests must use isolated test storage.`);
       throw new Error(`HARD SAFETY GUARD: Tests cannot send requests to production Supabase: ${fetchUrl}`);
    }
    return originalFetch(args[0], args[1]);
  };
}
