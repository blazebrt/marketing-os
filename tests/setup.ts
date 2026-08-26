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
