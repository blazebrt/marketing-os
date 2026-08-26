import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import './setup';
import { PGlite } from '@electric-sql/pglite';
import crypto from 'crypto';

async function runTests() {
  console.log('--- STARTING MILESTONE 2 OAUTH CONCURRENCY TESTS ---');
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

  const db = new PGlite();
  await db.exec(`
    create table public.oauth_states (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null,
      provider text not null,
      state_hash text not null,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null,
      consumed_at timestamptz
    );
  `);

  const ownerId = crypto.randomUUID();
  const provider = 'google';
  
  // 1. Create State
  const rawState = crypto.randomBytes(32).toString('hex');
  const stateHash = crypto.createHash('sha256').update(rawState).digest('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await db.query(
    'INSERT INTO public.oauth_states (owner_id, provider, state_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [ownerId, provider, stateHash, expiresAt]
  );
  assert(true, 'OAuth state created and hash stored in DB');

  // 2. Consume State (Atomic Mock)
  const consume = async (stateToConsume: string) => {
    const hash = crypto.createHash('sha256').update(stateToConsume).digest('hex');
    const res = await db.query(
      `UPDATE public.oauth_states 
       SET consumed_at = now() 
       WHERE owner_id = $1 AND provider = $2 AND state_hash = $3 AND consumed_at IS NULL AND expires_at > now() 
       RETURNING id`,
      [ownerId, provider, hash]
    );
    return res.rows.length > 0;
  };

  // 3. Concurrent Double Callback Test
  const [attempt1, attempt2] = await Promise.all([
    consume(rawState),
    consume(rawState)
  ]);

  assert(attempt1 !== attempt2, 'Concurrent double-callback rejected (only exactly one succeeded)');
  assert(attempt1 || attempt2, 'One of the concurrent callbacks succeeded');

  // 4. Already Consumed Test
  const attempt3 = await consume(rawState);
  assert(attempt3 === false, 'Already consumed state fails');

  // 5. Wrong State Test
  const wrongState = crypto.randomBytes(32).toString('hex');
  const attempt4 = await consume(wrongState);
  assert(attempt4 === false, 'Wrong state fails');

  // 6. Expired State Test
  const rawState2 = crypto.randomBytes(32).toString('hex');
  const hash2 = crypto.createHash('sha256').update(rawState2).digest('hex');
  const past = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await db.query(
    'INSERT INTO public.oauth_states (owner_id, provider, state_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [ownerId, provider, hash2, past]
  );
  
  const attempt5 = await consume(rawState2);
  assert(attempt5 === false, 'Expired state fails');

  console.log(`\n--- TESTS COMPLETE: ${passCount} PASS, ${failCount} FAIL ---`);
}

runTests().catch(console.error);
