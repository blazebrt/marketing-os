import { evaluateBiddingStrategy } from '../src/lib/providers/google/strategy';
import { StrategyContext } from '../src/lib/providers/google/types';

function runTests() {
  console.log('--- STARTING MILESTONE 5 STRATEGY TESTS ---');
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

  const coldContext: StrategyContext = {
    campaignType: 'search',
    conversionCount: 0,
    conversionWindowDays: 30,
    conversionTrackingReliability: 'UNKNOWN',
    budgetAmount: 1000,
    accountAgeDays: 5
  };

  const r1 = evaluateBiddingStrategy(coldContext);
  assert(r1.strategy === 'MANUAL_CPC', '1. Cold-start account -> MANUAL_CPC');
  assert(r1.reasons.length > 0, '5. Strategy recommendation contains reasons');
  assert(r1.safetyConstraints.length > 0, '6. Strategy recommendation contains safety constraints');

  const intermediateContext: StrategyContext = {
    campaignType: 'search',
    conversionCount: 5,
    conversionWindowDays: 30,
    conversionTrackingReliability: 'LOW',
    budgetAmount: 1000,
    accountAgeDays: 20
  };

  const r2 = evaluateBiddingStrategy(intermediateContext);
  assert(r2.strategy === 'MAXIMIZE_CLICKS', '2. Intermediate history -> MAXIMIZE_CLICKS');

  const strongContext: StrategyContext = {
    campaignType: 'search',
    conversionCount: 20,
    conversionWindowDays: 30,
    conversionTrackingReliability: 'HIGH',
    budgetAmount: 1000,
    accountAgeDays: 100
  };

  const r3 = evaluateBiddingStrategy(strongContext);
  assert(r3.strategy === 'MAXIMIZE_CONVERSIONS', '3. Strong reliable history -> MAXIMIZE_CONVERSIONS');

  console.log(`\n--- TESTS COMPLETE: ${passCount} PASS, ${failCount} FAIL ---`);
  if (failCount > 0) process.exit(1);
}
runTests();
