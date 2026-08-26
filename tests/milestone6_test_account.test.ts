import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import './setup';
import { PGlite } from '@electric-sql/pglite';
import crypto from 'crypto';
import * as googleAdsApi from 'google-ads-api';
import { verifyTestAccount, __setMockGoogleAdsApi } from '../src/lib/providers/google/test-account';

async function runTests() {
  console.log('--- STARTING MILESTONE 6 TEST ACCOUNT VERIFICATION TESTS ---');
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

  // Mock google-ads-api
  let mockCustomerQuery = async (query: string): Promise<any[]> => [];

  class MockCustomer {
    async query(q: string) {
      return mockCustomerQuery(q);
    }
  }

  class MockGoogleAdsApi {
    constructor(opts: any) {}
    Customer() {
      return new MockCustomer();
    }
  }

  __setMockGoogleAdsApi(MockGoogleAdsApi);

  // TEST 1: Missing execution mode fails
  {
    process.env.GOOGLE_ADS_EXECUTION_MODE = 'production';
    let failed = false;
    try {
      await verifyTestAccount('dev_token', 'refresh', 'client', 'secret', '123-456-7890', '098-765-4321');
    } catch (err: any) {
      if (err.code === 'GOOGLE_TEST_ACCOUNT_REQUIRED') failed = true;
    }
    assert(failed, 'Missing/Invalid execution mode blocks mutation');
  }

  process.env.GOOGLE_ADS_EXECUTION_MODE = 'test';

  // TEST 2: Missing tokens fails
  {
    let failed = false;
    try {
      await verifyTestAccount('', 'refresh', 'client', 'secret', '123-456-7890', '098-765-4321');
    } catch (err: any) {
      if (err.code === 'GOOGLE_TEST_ACCOUNT_REQUIRED') failed = true;
    }
    assert(failed, 'Missing developer token blocks mutation');
  }

  // TEST 3: Invalid OAuth blocks mutation (simulated via query throw)
  {
    mockCustomerQuery = async () => { throw new Error('AUTHENTICATION_ERROR'); };
    let failed = false;
    try {
      await verifyTestAccount('dev_token', 'refresh', 'client', 'secret', '123-456-7890', '098-765-4321');
    } catch (err: any) {
      if (err.code === 'GOOGLE_TEST_ACCOUNT_REQUIRED') failed = true;
    }
    assert(failed, 'Invalid OAuth blocks mutation');
  }

  // TEST 4: Production customer ID rejected
  {
    mockCustomerQuery = async () => [{ customer: { id: '1234567890', test_account: false, descriptive_name: 'Prod' } }];
    let failed = false;
    try {
      await verifyTestAccount('dev_token', 'refresh', 'client', 'secret', '123-456-7890', '098-765-4321');
    } catch (err: any) {
      if (err.code === 'GOOGLE_TEST_ACCOUNT_REQUIRED') failed = true;
    }
    assert(failed, 'Production customer ID rejected');
  }

  // TEST 5: Test customer accepted
  {
    mockCustomerQuery = async () => [{ customer: { id: '1234567890', test_account: true, descriptive_name: 'Test' } }];
    let failed = false;
    try {
      await verifyTestAccount('dev_token', 'refresh', 'client', 'secret', '123-456-7890', '098-765-4321');
    } catch (err: any) {
      failed = true;
    }
    assert(!failed, 'Test customer accepted');
  }

  console.log(`\n--- TESTS COMPLETE: ${passCount} PASS, ${failCount} FAIL ---`);
  if (failCount > 0) process.exit(1);
}

runTests().catch(console.error);
