import './setup';
import assert from 'node:assert/strict';
import { createM7Database } from './helpers/m7Harness.ts';
import { hashLoginEmail } from '../src/lib/auth/loginThrottle.ts';

const hash = hashLoginEmail('owner@example.com');
const db = await createM7Database();

await db.query('select public.rpc_record_login_failure($1)', [hash]);
await db.query('select public.rpc_record_login_failure($1)', [hash]);

const { rows: afterTwo } = await db.query(
  'select attempt_count, locked_until from public.login_throttle where email_hash=$1',
  [hash]
) as { rows: { attempt_count: number; locked_until: string | null }[] };
assert.equal(afterTwo[0].attempt_count, 2);
assert.equal(afterTwo[0].locked_until, null);

for (let i = 0; i < 6; i += 1) {
  await db.query('select public.rpc_record_login_failure($1)', [hash]);
}

const { rows: locked } = await db.query(
  'select attempt_count, locked_until from public.login_throttle where email_hash=$1',
  [hash]
) as { rows: { attempt_count: number; locked_until: string | null }[] };
assert.equal(locked[0].attempt_count, 8);
assert.ok(locked[0].locked_until, 'eighth failure sets locked_until');

await db.query('select public.rpc_record_login_failure($1)', [hash]);
const { rows: stillLocked } = await db.query(
  'select attempt_count from public.login_throttle where email_hash=$1',
  [hash]
) as { rows: { attempt_count: number }[] };
assert.equal(stillLocked[0].attempt_count, 8, 'failures during lock do not increment');

console.log('login throttle RPC tests passed');
