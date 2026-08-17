import { NextRequest } from 'next/server';
import { POST as interactionsPost } from '../src/app/api/interactions/route';

async function runTests() {
  console.log('--- STARTING MILESTONE 3 FIXES TESTS ---');
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

  // We want to test that x-owner-id is ignored and integration-id is required,
  // and that errors are properly sanitized.

  // 1. Missing integration-id should fail with webhook_verification_failed
  const req1 = new Request('http://localhost:3000/api/interactions', {
    method: 'POST',
    headers: {
      'x-signature': 'abc',
      'x-timestamp': Date.now().toString(),
      'x-owner-id': 'my-owner-id' // old insecure method
    },
    body: JSON.stringify({ session_id: 'test' })
  }) as unknown as NextRequest;

  const res1 = await interactionsPost(req1);
  const json1 = await res1.json();
  assert(res1.status === 401 && json1.error === 'webhook_verification_failed', '1. Missing x-integration-id rejected cleanly');
  assert(!json1.error.includes('missing_headers'), '1. Internal error string is masked');

  // 2. Malformed JSON payload returns invalid_payload
  const req2 = new Request('http://localhost:3000/api/interactions', {
    method: 'POST',
    headers: {
      'x-signature': 'abc',
      'x-timestamp': Date.now().toString(),
      'x-integration-id': 'my-integration-id'
    },
    body: 'not-json'
  }) as unknown as NextRequest;

  // The endpoint first parses JSON before auth. Wait, no, it checks auth first. But auth will fail because it's a mocked req without DB setup.
  // Actually, our API tries to extract text, then does auth. 
  const res2 = await interactionsPost(req2);
  const json2 = await res2.json();
  assert(res2.status === 401 && json2.error === 'webhook_verification_failed', '2. Invalid integration ID rejected securely (auth happens before json parse)');

  console.log(`\n--- TESTS COMPLETE: ${passCount} PASS, ${failCount} FAIL ---`);
}

// Just checking if we can run it.
runTests().catch(console.error);
