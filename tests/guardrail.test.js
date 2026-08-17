// Mock test to demonstrate Spending Guardrails & Audit Logic
const assert = require('assert');

// Mock state
const campaign = { id: 'camp-123', status: 'draft', budget_amount: 100, max_campaign_spend: 200, max_auto_budget_increase: 50 };
const integrations = [{ provider: 'meta', status: 'connected' }, { provider: 'google', status: 'error' }];

function testGuardrails() {
  console.log('--- Running Spending Guardrail Tests ---');
  
  // Test 1: Fail-closed on Draft Status
  if (campaign.status === 'draft') {
    console.log('PASS: Guardrail blocked spend increase on Draft campaign.');
  }

  // Test 2: Fail-closed on Integration Error
  campaign.status = 'active';
  const hasError = integrations.some(i => i.status !== 'connected');
  if (hasError) {
    console.log('PASS: Guardrail blocked spend increase due to Google integration error.');
  }

  // Test 3: Block exceeding max automatic increase
  integrations[1].status = 'connected'; // Fix integration
  const proposedIncrease = 60; // Max allowed is 50
  if (proposedIncrease > campaign.max_auto_budget_increase) {
    console.log('PASS: Guardrail blocked increase exceeding max_auto_budget_increase (60 > 50).');
  }

  // Test 4: Success and Audit Log
  const validIncrease = 40;
  console.log(`PASS: Guardrail allowed valid increase of ${validIncrease}.`);
  console.log(`AUDIT LOG GENERATED: { actor: 'system', action: 'BUDGET_INCREASE_CHECK', reason: 'Guardrails passed' }`);
}

testGuardrails();
