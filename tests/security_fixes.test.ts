import './setup';
import crypto from 'crypto';
import { verifyHmac, authenticateWebhook } from '../src/lib/webhooks/verify';
import {
  encryptCredential,
  decryptCredential,
  parseStoredCredentials,
  revealStoredSecret,
  decryptNamedSecret,
  timingSafeEqualString,
} from '../src/lib/crypto';
import { isUuid } from '../src/lib/ids';
import { InteractionSchema } from '../src/lib/schemas/tracking';
import { calculateSafetyLimits, normaliseBudgetType } from '../src/lib/campaigns/safeguards';
import { gaqlIntLiteral, gaqlStringLiteral } from '../src/lib/providers/google/gaql';
import { CampaignIntentSchema } from '../src/lib/schemas/campaigns';
import { appOrigin } from '../src/lib/appUrl';
import { campaignDisplayName, campaignLandingUrl } from '../src/lib/campaigns/fields';
import { sanitiseIntegrationCredentials } from '../src/lib/integrations';
import { hashLoginEmail, isLoginLocked, nextFailureState, LOGIN_THROTTLE } from '../src/lib/auth/loginThrottle';
import { __setMockServiceClient } from '../src/lib/supabase/service';
import { NextRequest } from 'next/server';

async function main() {
  let pass = 0;
  let fail = 0;
  const assert = (cond: boolean, msg: string) => {
    if (cond) { console.log('PASS: ' + msg); pass += 1; }
    else { console.error('FAIL: ' + msg); fail += 1; }
  };

  console.log('--- HMAC TIMESTAMP ---');
  const secret = 'webhook-secret';
  const payload = '{"ok":true}';
  const badTs = 'not-a-number';
  const badSig = crypto.createHmac('sha256', secret).update(badTs + '.' + payload).digest('hex');
  assert(await verifyHmac(payload, badSig, secret, badTs) === false, 'Non-numeric HMAC timestamp is rejected');
  assert(await verifyHmac(payload, badSig, secret, '') === false, 'Empty HMAC timestamp is rejected');

  const ts = Date.now().toString();
  const sig = crypto.createHmac('sha256', secret).update(ts + '.' + payload).digest('hex');
  assert(await verifyHmac(payload, sig, secret, ts) === true, 'Valid HMAC still accepted');
  assert(await verifyHmac(payload, sig.toUpperCase(), secret, ts) === true, 'HMAC hex is compared case-insensitively');

  const badIdReq = new NextRequest('http://localhost:3000/api/interactions', {
    method: 'POST',
    headers: {
      'x-signature': sig,
      'x-timestamp': ts,
      'x-integration-id': 'not-a-uuid',
    },
    body: payload,
  });
  try {
    await authenticateWebhook(badIdReq, payload);
    assert(false, 'Non-UUID integration id should throw');
  } catch {
    assert(true, 'Non-UUID webhook integration id is rejected');
  }

  console.log('\n--- CREDENTIAL STORAGE ---');
  const token = 'refresh-token-value';
  const jsonStored = JSON.stringify({
    refresh_token: encryptCredential(token),
    hmac_secret: encryptCredential(secret),
  });
  const parsed = parseStoredCredentials(jsonStored);
  assert(revealStoredSecret(parsed.refresh_token) === token, 'JSON credential blob decrypts token fields');
  assert(revealStoredSecret(parsed.hmac_secret) === secret, 'JSON credential blob decrypts hmac_secret');
  assert(decryptNamedSecret(jsonStored, 'refresh_token') === token, 'decryptNamedSecret reads encrypted token fields');

  const cleaned = parseStoredCredentials('{"refresh_token":"plain","__proto__":{"admin":true}}');
  assert(Object.prototype.hasOwnProperty.call(cleaned, 'refresh_token'), 'Credential parse keeps own fields');
  assert(!Object.prototype.hasOwnProperty.call(cleaned, '__proto__'), 'Credential parse drops __proto__');

  const legacy = encryptCredential(JSON.stringify({ hmac_secret: 'plain-hmac' }));
  assert(parseStoredCredentials(legacy).hmac_secret === 'plain-hmac', 'Legacy whole-blob encryption still parses');

  try {
    decryptCredential('not:valid');
    assert(false, 'Malformed ciphertext should throw');
  } catch (e: any) {
    assert(String(e.message).includes('Invalid encrypted format'), 'decryptCredential rejects malformed input');
  }

  console.log('\n--- WEBHOOK AUTH MATCHES STORAGE ---');
  const integrationId = '11111111-1111-4111-8111-111111111111';
  __setMockServiceClient(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              owner_id: 'owner-1',
              provider: 'website',
              encrypted_credentials: jsonStored,
            },
            error: null,
          }),
        }),
      }),
    }),
  }));
  const body = '{"session_id":"s1","interaction_type":"website_visit"}';
  const timestamp = Date.now().toString();
  const signature = crypto.createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');
  const req = new NextRequest('http://localhost:3000/api/interactions', {
    method: 'POST',
    headers: {
      'x-signature': signature,
      'x-timestamp': timestamp,
      'x-integration-id': integrationId,
    },
    body,
  });
  const auth = await authenticateWebhook(req, body);
  assert(auth.ownerId === 'owner-1' && auth.provider === 'website', 'Webhook HMAC verifies against JSON-stored credentials');
  __setMockServiceClient(null);

  console.log('\n--- BUDGET TYPE ---');
  assert(normaliseBudgetType('total') === 'total', 'UI budget type total is recognised');
  assert(normaliseBudgetType('LIFETIME') === 'total', 'Legacy lifetime maps to total');
  assert(normaliseBudgetType('daily') === 'daily', 'Daily budget type is recognised');
  assert(normaliseBudgetType('monthly') === null, 'Unknown budget types are rejected');
  const limits = calculateSafetyLimits('total', 10000, 10);
  assert(limits.maxTotal === 10000 && limits.maxDaily === 1000, 'Total budget uses the total-campaign path, not daily');

  console.log('\n--- CHANNELS AND GAQL ---');
  const channels = CampaignIntentSchema.safeParse({
    service: 'Keratin',
    offer: '20% off',
    budget_type: 'daily',
    budget_amount: 500,
    duration_days: 14,
    destination_type: 'WEBSITE',
    landing_url: 'https://example.com',
    channels: ['Google', 'google'],
  });
  assert(channels.success === true, 'Campaign channels accept mixed-case Google');
  assert(JSON.stringify(channels.success ? channels.data.channels : []) === JSON.stringify(['google']), 'Channels are lowercased and de-duplicated');

  const junk = CampaignIntentSchema.safeParse({
    service: 'Keratin',
    offer: '20% off',
    budget_type: 'daily',
    budget_amount: 500,
    duration_days: 14,
    destination_type: 'WEBSITE',
    channels: ['not-a-network'],
  });
  assert(junk.success === false, 'Unknown channels are rejected');

  const tooLong = CampaignIntentSchema.safeParse({
    service: 'K'.repeat(200),
    offer: '20% off',
    budget_type: 'daily',
    budget_amount: 500,
    duration_days: 14,
    destination_type: 'WEBSITE',
    channels: ['google'],
  });
  assert(tooLong.success === false, 'Over-long campaign service is rejected');

  assert(isUuid('11111111-1111-4111-8111-111111111111') === true, 'Valid UUID is accepted');
  assert(isUuid('not-a-uuid') === false, 'Non-UUID campaign ids are rejected');
  assert(InteractionSchema.safeParse({ session_id: 's1', interaction_type: 'website_visit' }).success === true, 'Bounded interaction payload accepted');
  assert(InteractionSchema.safeParse({ session_id: 's'.repeat(200), interaction_type: 'website_visit' }).success === false, 'Over-long session_id is rejected');

  assert(gaqlStringLiteral("MKTOS-E2E-abc-BUDGET") === "'MKTOS-E2E-abc-BUDGET'", 'Safe GAQL names are quoted');
  assert(gaqlStringLiteral("O'Brien") === "'O\\'Brien'", 'Quotes in GAQL literals are escaped');
  assert(gaqlIntLiteral('123-456-7890') === '1234567890', 'Google customer ids are digit-only in GAQL');
  try {
    gaqlIntLiteral("1; SELECT");
    assert(false, 'Non-digit GAQL integers should throw');
  } catch {
    assert(true, 'Non-digit GAQL integers are rejected');
  }
  try {
    gaqlStringLiteral("x\nOR 1=1");
    assert(false, 'Newlines in GAQL should throw');
  } catch {
    assert(true, 'Newlines in GAQL literals are rejected');
  }

  console.log('\n--- APP ORIGIN ---');
  const prev = process.env.NEXT_PUBLIC_BASE_URL;
  process.env.NEXT_PUBLIC_BASE_URL = 'https://marketing.example.com';
  assert(appOrigin('http://evil.example/login') === 'https://marketing.example.com', 'Redirects use configured base URL, not Host');
  if (prev === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
  else process.env.NEXT_PUBLIC_BASE_URL = prev;

  console.log('\n--- DEPLOY FIELDS AND CREDENTIAL WHITELIST ---');
  assert(campaignDisplayName({ service: 'Keratin' }) === 'Keratin', 'Ad group name uses campaign service');
  assert(campaignDisplayName({}) === 'Campaign', 'Missing service falls back to Campaign');
  assert(
    campaignLandingUrl({ landing_url: 'https://salon.example.com', destination: 'WEBSITE' }) === 'https://salon.example.com',
    'Landing URL is used instead of destination type'
  );
  assert(campaignLandingUrl({ destination: 'WEBSITE' }) === null, 'Destination type alone is not a URL');
  assert(
    campaignLandingUrl({ destination: 'https://legacy.example.com/book' }) === 'https://legacy.example.com/book',
    'Legacy URL stored in destination still resolves'
  );

  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
  const sanitised = sanitiseIntegrationCredentials({
    access_token: 'ya29.access',
    refresh_token: '1//refresh',
    id_token: 'eyJhbGciOi.should-not-store',
    scope: 'https://www.googleapis.com/auth/adwords',
    expiry_date: 1700000000000,
    extra_secret: 'drop-me',
  });
  assert(sanitised !== null && typeof sanitised.access_token === 'string', 'Access token is kept and encrypted');
  assert(sanitised !== null && !('id_token' in sanitised), 'id_token is not persisted');
  assert(sanitised !== null && !('extra_secret' in sanitised), 'Unknown credential fields are dropped');
  assert(sanitised !== null && sanitised.scope === 'https://www.googleapis.com/auth/adwords', 'OAuth scope is kept');

  assert(timingSafeEqualString('cron-secret', 'cron-secret') === true, 'Equal cron secrets match');
  assert(timingSafeEqualString('short', 'cron-secret-longer') === false, 'Length mismatch still compared safely');
  assert(timingSafeEqualString('aaa', 'bbb') === false, 'Different secrets do not match');

  console.log('\n--- LOGIN THROTTLE ---');
  const now = Date.parse('2026-08-30T12:00:00Z');
  assert(hashLoginEmail('A@X.com') === hashLoginEmail('a@x.com'), 'Login throttle hashes emails case-insensitively');
  assert(isLoginLocked(null, now) === false, 'Missing throttle row is not locked');
  assert(isLoginLocked({ attempt_count: 8, window_started_at: new Date(now).toISOString(), locked_until: new Date(now + 1000).toISOString() }, now) === true, 'Active lock blocks login');
  assert(isLoginLocked({ attempt_count: 8, window_started_at: new Date(now).toISOString(), locked_until: new Date(now - 1000).toISOString() }, now) === false, 'Expired lock does not block');
  let state = null as ReturnType<typeof nextFailureState> | null;
  for (let i = 0; i < LOGIN_THROTTLE.maxAttempts; i += 1) {
    state = nextFailureState(state, now + i);
  }
  assert(state !== null && state.locked_until !== null, 'Eighth failed attempt locks the address');
  const afterWindow = nextFailureState(state, now + LOGIN_THROTTLE.windowMs + 1);
  assert(afterWindow.attempt_count === 1 && afterWindow.locked_until === null, 'A new window starts after the old one expires');

  console.log(`\n--- SECURITY FIXES: ${pass} PASS, ${fail} FAIL ---`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
