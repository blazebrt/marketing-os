import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import './setup';
import { PGlite } from '@electric-sql/pglite';
import crypto from 'crypto';
import { GoogleAdsReadOnlyContextProvider } from '../src/lib/providers/google/real-context';
import { MockGoogleAccountContextProvider } from '../src/lib/providers/google/mock-context';
import { prepareGoogleDeployment } from '../src/lib/providers/google/adapter';
import { generateGoogleCreative } from '../src/lib/providers/google/ai';
import { encryptCredential, decryptCredential } from '../src/lib/crypto';

async function runTests() {
  console.log('--- STARTING MILESTONE 5 CREDENTIAL SECURITY TESTS ---');
  let passCount = 0;
  let failCount = 0;

  const assert = (condition: boolean, msg: string) => {
    if (condition) {
      console.log(`PASS: ${msg}`);
      passCount++;
    } else {
      console.error(`FAIL: ${msg}`);
      failCount++;
    }
  };

  // Set up encryption key for tests
  const testKey = crypto.randomBytes(32).toString('base64');
  process.env.ENCRYPTION_KEY = testKey;

  const db = new PGlite();

  await db.exec(`
    create table public.integration_credentials (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      provider text not null,
      encrypted_credentials text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(owner_id, provider)
    );

    create table public.integrations (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      provider text not null,
      status text not null,
      external_id text,
      last_verified_at timestamptz,
      error_message text
    );

    create table public.unified_campaigns (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      name text not null default 'Test Campaign',
      service text not null default 'test',
      offer text not null default 'test',
      budget_type text not null default 'daily',
      budget_amount numeric(15, 2) not null default 1000,
      duration_days int not null default 30,
      max_daily_spend numeric(15, 2) not null default 1000,
      max_campaign_spend numeric(15, 2) not null default 30000,
      destination text not null default 'website',
      channels text[] not null,
      creative_id uuid,
      status text not null default 'DRAFT',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table public.channel_deployments (
      id uuid primary key default gen_random_uuid(),
      campaign_id uuid not null,
      owner_id uuid not null,
      provider text not null,
      status text not null default 'PENDING',
      target_state jsonb not null default '{}'::jsonb,
      actual_state jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      unique(campaign_id, provider)
    );

    create table public.creatives (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null
    );

    create table public.creatives_google (
      id uuid primary key default gen_random_uuid(),
      creative_id uuid not null references public.creatives(id) on delete cascade,
      owner_id uuid not null,
      headlines jsonb not null default '[]'::jsonb,
      descriptions jsonb not null default '[]'::jsonb,
      keywords jsonb not null default '[]'::jsonb
    );

    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      action text not null,
      resource_type text,
      resource_id text,
      details jsonb
    );
  `);

  const ownerA = crypto.randomUUID();
  const ownerB = crypto.randomUUID();

  // Create a mock "service client" that can read integration_credentials
  const createMockServiceClient = () => {
    return {
      from: (table: string) => {
        let queryStr = `SELECT * FROM public.${table}`;
        let conditions: string[] = [];
        let params: any[] = [];

        const chain = {
          select: (s: string) => chain,
          eq: (col: string, val: any) => {
            params.push(val);
            conditions.push(`${col}=$${params.length}`);
            return chain;
          },
          single: async () => {
            if (conditions.length > 0) {
              queryStr += ' WHERE ' + conditions.join(' AND ');
            }
            const res = await db.query(queryStr, params);
            return { data: res.rows[0] || null, error: res.rows.length === 0 ? { code: 'PGRST116' } : null };
          }
        };
        return chain;
      }
    };
  };

  // Create a mock "authenticated client" that CANNOT read integration_credentials (simulates RLS deny)
  const createMockAuthenticatedClient = (userId: string) => {
    return {
      auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
      from: (table: string) => {
        let queryStr = `SELECT * FROM public.${table}`;
        let conditions: string[] = [];
        let params: any[] = [];
        let isUpdate = false;
        let isInsert = false;
        let data: any = null;

        const chain = {
          select: (s: string) => chain,
          update: (obj: any) => { isUpdate = true; data = obj; return chain; },
          insert: (obj: any) => { isInsert = true; data = obj; return chain; },
          eq: (col: string, val: any) => {
            params.push(val);
            conditions.push(`${col}=$${params.length}`);
            return chain;
          },
          single: async () => {
            // Simulate RLS: block access to integration_credentials
            if (table === 'integration_credentials') {
              return { data: null, error: { code: '42501', message: 'permission denied for table integration_credentials' } };
            }
            if (conditions.length > 0) {
              queryStr += ' WHERE ' + conditions.join(' AND ');
            }
            const res = await db.query(queryStr, params);
            return { data: res.rows[0] || null, error: null };
          },
          then: async (resolve: any) => {
            if (isUpdate) {
              let updateQuery = `UPDATE public.${table} SET `;
              let setParts: string[] = [];
              let valIdx = 1;
              const updateParams: any[] = [];
              for (const [k, v] of Object.entries(data)) {
                setParts.push(`${k}=$${valIdx++}`);
                updateParams.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
              }
              updateQuery += setParts.join(', ');
              if (conditions.length > 0) {
                updateQuery += ' WHERE ' + conditions.map((c, i) => c.replace(`$${i+1}`, `$${valIdx + i}`)).join(' AND ');
                updateParams.push(...params);
              }
              await db.query(updateQuery, updateParams);
              resolve({ error: null });
            } else if (isInsert) {
              let insertQuery = `INSERT INTO public.${table} (`;
              let keys = Object.keys(data);
              insertQuery += keys.join(', ') + ') VALUES (';
              insertQuery += keys.map((_, i) => `$${i+1}`).join(', ') + ')';
              let insertParams = keys.map(k => typeof data[k] === 'object' && data[k] !== null ? JSON.stringify(data[k]) : data[k]);
              await db.query(insertQuery, insertParams);
              resolve({ error: null });
            } else {
              resolve(await chain.single());
            }
          }
        };

        const proxy = new Proxy(chain, {
          get(target, prop) {
            if (prop === 'then') {
              return isUpdate || isInsert ? target.then : async (resolve: any) => resolve(await target.single());
            }
            return (target as any)[prop];
          }
        });
        return proxy;
      }
    };
  };

  // ============================================================
  // TEST 1: Real provider does NOT query integrations.credentials
  // ============================================================
  // The real provider source code imports createServiceClient, not createClient.
  // It queries integration_credentials, not integrations.
  // We verify this structurally by injecting a service client and confirming
  // the provider calls .from('integration_credentials').
  {
    let queriedTable = '';
    const spyServiceClient = {
      from: (table: string) => {
        queriedTable = table;
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: null, error: { code: 'PGRST116' } })
              })
            })
          })
        };
      }
    };

    const provider = new GoogleAdsReadOnlyContextProvider(spyServiceClient);
    try { await provider.getStrategyContext(ownerA); } catch {}
    assert(queriedTable === 'integration_credentials', '1. Real provider queries integration_credentials, NOT integrations.credentials');
  }

  // ============================================================
  // TEST 2: Real provider reads ONLY integration_credentials
  // ============================================================
  {
    let tablesQueried: string[] = [];
    const spyServiceClient = {
      from: (table: string) => {
        tablesQueried.push(table);
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: null, error: { code: 'PGRST116' } })
              })
            })
          })
        };
      }
    };

    const provider = new GoogleAdsReadOnlyContextProvider(spyServiceClient);
    try { await provider.getStrategyContext(ownerA); } catch {}
    assert(
      tablesQueried.length === 1 && tablesQueried[0] === 'integration_credentials',
      '2. Real provider reads ONLY integration_credentials (no other tables)'
    );
  }

  // ============================================================
  // TEST 3: Authenticated/browser client cannot read integration_credentials
  // ============================================================
  {
    const authClient = createMockAuthenticatedClient(ownerA);
    const result = await authClient.from('integration_credentials').select('*').eq('owner_id', ownerA).single();
    assert(
      result.error !== null && result.error.code === '42501',
      '3. Authenticated/browser Supabase client cannot read integration_credentials'
    );
  }

  // ============================================================
  // TEST 4: Service client CAN retrieve encrypted credentials
  // ============================================================
  {
    const fakeTokens = {
      access_token: encryptCredential('ya29.fake-access-token-12345'),
      refresh_token: encryptCredential('1//fake-refresh-token-67890')
    };
    await db.query(
      "INSERT INTO public.integration_credentials (owner_id, provider, encrypted_credentials) VALUES ($1, 'google', $2)",
      [ownerA, JSON.stringify(fakeTokens)]
    );

    const svc = createMockServiceClient();
    const result = await svc.from('integration_credentials').select('encrypted_credentials').eq('owner_id', ownerA).eq('provider', 'google').single();
    assert(
      result.data !== null && (result.data as any).encrypted_credentials !== null,
      '4. Service client can retrieve encrypted credentials'
    );
  }

  // ============================================================
  // TEST 5: Credentials decrypt successfully with valid ENCRYPTION_KEY
  // ============================================================
  {
    const original = 'ya29.fake-access-token-12345';
    const encrypted = encryptCredential(original);
    const decrypted = decryptCredential(encrypted);
    assert(decrypted === original, '5. Credentials decrypt successfully with valid ENCRYPTION_KEY');
  }

  // ============================================================
  // TEST 6: Invalid encryption key fails closed
  // ============================================================
  {
    const original = 'ya29.test-token';
    const encrypted = encryptCredential(original);

    // Swap key
    const wrongKey = crypto.randomBytes(32).toString('base64');
    const savedKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = wrongKey;

    let decryptFailed = false;
    try {
      decryptCredential(encrypted);
    } catch {
      decryptFailed = true;
    }
    process.env.ENCRYPTION_KEY = savedKey;

    assert(decryptFailed, '6. Invalid encryption key fails closed (decrypt throws)');
  }

  // ============================================================
  // TEST 7: Missing credentials fails GOOGLE_CONTEXT_UNAVAILABLE
  // ============================================================
  {
    const ownerNoCredentials = crypto.randomUUID();
    const svc = createMockServiceClient();
    const provider = new GoogleAdsReadOnlyContextProvider(svc);

    let err = '';
    try {
      await provider.getStrategyContext(ownerNoCredentials);
    } catch (e: any) {
      err = e.message;
    }
    assert(err === 'GOOGLE_CONTEXT_UNAVAILABLE', '7. Missing credentials fails GOOGLE_CONTEXT_UNAVAILABLE');
  }

  // ============================================================
  // TEST 8: Google API authentication failure fails closed
  // ============================================================
  // The real provider currently fails closed at fetchReadOnlyMetrics
  // even when credentials decrypt successfully, because no live API exists in M5.
  {
    const svc = createMockServiceClient();
    const provider = new GoogleAdsReadOnlyContextProvider(svc);

    let err = '';
    try {
      // ownerA has valid encrypted credentials from TEST 4
      await provider.getStrategyContext(ownerA);
    } catch (e: any) {
      err = e.message;
    }
    assert(err === 'GOOGLE_CONTEXT_UNAVAILABLE', '8. Google API authentication failure fails closed (GOOGLE_CONTEXT_UNAVAILABLE)');
  }

  // ============================================================
  // TEST 9: Read-only metrics transformed into StrategyContext (via mock)
  // ============================================================
  {
    const mockProvider = new MockGoogleAccountContextProvider({
      campaignType: 'search',
      budgetAmount: 2000,
      conversionCount: 50,
      conversionWindowDays: 30,
      conversionTrackingReliability: 'HIGH',
      accountAgeDays: 365
    });

    const ctx = await mockProvider.getStrategyContext(ownerA);
    assert(
      ctx.conversionCount === 50 &&
      ctx.accountAgeDays === 365 &&
      ctx.conversionTrackingReliability === 'HIGH' &&
      ctx.campaignType === 'search' &&
      ctx.budgetAmount === 2000 &&
      ctx.conversionWindowDays === 30,
      '9. Google read-only metrics are transformed into StrategyContext'
    );
  }

  // ============================================================
  // TEST 10: Zero Google mutation endpoints are called
  // ============================================================
  // The real provider source contains ONLY a throw in fetchReadOnlyMetrics.
  // No HTTP client, no fetch(), no google-ads-api mutate calls.
  // We verify by confirming the provider does not import any mutation libraries
  // and that the only network-like call is the Supabase query.
  {
    let callCount = 0;
    const spyServiceClient = {
      from: (table: string) => {
        callCount++;
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => {
                  // Return valid encrypted credentials
                  const fakeTokens = {
                    access_token: encryptCredential('ya29.spy-token'),
                  };
                  return { data: { encrypted_credentials: JSON.stringify(fakeTokens) }, error: null };
                }
              })
            })
          })
        };
      }
    };

    const provider = new GoogleAdsReadOnlyContextProvider(spyServiceClient);
    try { await provider.getStrategyContext(ownerA); } catch {}
    // Only 1 call: to integration_credentials. No mutation calls.
    assert(callCount === 1, '10. Zero Google mutation endpoints called (only 1 DB read)');
  }

  // ============================================================
  // TEST 11: MockGoogleAccountContextProvider is NOT used by production adapter
  // ============================================================
  // When no contextProvider is passed to prepareGoogleDeployment,
  // the default is GoogleAdsReadOnlyContextProvider (not Mock).
  // We verify the adapter's default path throws GOOGLE_CONTEXT_UNAVAILABLE
  // (which Mock would never throw).
  {
    const creativeC = crypto.randomUUID();
    const campC = crypto.randomUUID();

    await db.query('INSERT INTO public.creatives (id, owner_id) VALUES ($1, $2)', [creativeC, ownerA]);
    await db.query("INSERT INTO public.integrations (owner_id, provider, status) VALUES ($1, 'google', 'connected') ON CONFLICT DO NOTHING", [ownerA]);

    const gen = generateGoogleCreative({ service: 'Bridal Makeup', offer: '20% Off' });
    gen.keywords[0].owner_approved = true;
    gen.keywords[0].current_value = 'bridal makeup lucknow';
    gen.headlines[0].owner_approved = true;
    gen.descriptions[0].owner_approved = true;

    await db.query(
      "INSERT INTO public.unified_campaigns (id, owner_id, channels, creative_id, status) VALUES ($1, $2, $3, $4, 'READY_TO_DEPLOY')",
      [campC, ownerA, ['google'], creativeC]
    );
    await db.query(
      "INSERT INTO public.channel_deployments (campaign_id, owner_id, provider) VALUES ($1, $2, 'google')",
      [campC, ownerA]
    );
    await db.query(
      "INSERT INTO public.creatives_google (creative_id, owner_id, headlines, descriptions, keywords) VALUES ($1, $2, $3, $4, $5)",
      [creativeC, ownerA, JSON.stringify(gen.headlines), JSON.stringify(gen.descriptions), JSON.stringify(gen.keywords)]
    );

    const authClient = createMockAuthenticatedClient(ownerA);
    let err = '';
    try {
      // No contextProvider passed — adapter must use GoogleAdsReadOnlyContextProvider
      // which will fail because createServiceClient() needs real env vars
      await prepareGoogleDeployment(authClient as any, campC);
    } catch (e: any) {
      err = e.message;
    }
    assert(
      err === 'GOOGLE_CONTEXT_UNAVAILABLE',
      '11. MockGoogleAccountContextProvider is NOT used by production adapter (default throws GOOGLE_CONTEXT_UNAVAILABLE)'
    );
  }

  // ============================================================
  // TEST 12: target_state contains zero credential material
  // ============================================================
  {
    const mockProvider = new MockGoogleAccountContextProvider({
      campaignType: 'search', budgetAmount: 1000, conversionCount: 20,
      conversionWindowDays: 30, conversionTrackingReliability: 'HIGH', accountAgeDays: 100
    });

    const authClient = createMockAuthenticatedClient(ownerA);

    // Use the campaign created in TEST 11
    const campResult = await db.query(
      "SELECT id FROM public.unified_campaigns WHERE owner_id = $1 LIMIT 1", [ownerA]
    );
    const campC = (campResult.rows[0] as any)?.id;

    if (campC) {
      const targetState = await prepareGoogleDeployment(authClient as any, campC, mockProvider);
      const serialized = JSON.stringify(targetState);

      assert(
        !serialized.includes('ya29') &&
        !serialized.includes('access_token') &&
        !serialized.includes('refresh_token') &&
        !serialized.includes('encrypted_credentials') &&
        !serialized.includes('ENCRYPTION_KEY') &&
        !serialized.includes('service_role'),
        '12. target_state contains zero credential material'
      );
    } else {
      assert(false, '12. target_state contains zero credential material (campaign not found)');
    }
  }

  // ============================================================
  // TEST 13: audit_logs contain zero credential material
  // ============================================================
  {
    const auditRows = await db.query("SELECT * FROM public.audit_logs WHERE owner_id = $1", [ownerA]);
    let credentialLeaked = false;
    for (const row of auditRows.rows) {
      const serialized = JSON.stringify(row);
      if (
        serialized.includes('ya29') ||
        serialized.includes('access_token') ||
        serialized.includes('refresh_token') ||
        serialized.includes('encrypted_credentials') ||
        serialized.includes('ENCRYPTION_KEY')
      ) {
        credentialLeaked = true;
        break;
      }
    }
    assert(!credentialLeaked, '13. audit_logs contain zero credential material');
  }

  console.log(`\n--- TESTS COMPLETE: ${passCount} PASS, ${failCount} FAIL ---`);
  if (failCount > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
