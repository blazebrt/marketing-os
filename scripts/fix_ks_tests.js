const fs = require('fs');

let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

content = content.replace(
  "assert(e.message.includes('REAL_TEST_MUTATION_NOT_AUTHORIZED'), 'KS2. allow mutations != true blocked')",
  "assert(e.message.includes('Mutations are explicitly disabled'), 'KS2. allow mutations != true blocked')"
);
content = content.replace(
  "assert(e.message.includes('REAL_TEST_MUTATION_NOT_AUTHORIZED'), 'KS5. production NODE_ENV blocked')",
  "assert(e.message.includes('Test mutations cannot run in a production environment'), 'KS5. production NODE_ENV blocked')"
);
content = content.replace(
  "assert(e.message.includes('REAL_TEST_MUTATION_NOT_AUTHORIZED'), 'KS7. unconfirmed blocked')",
  "assert(e.message.includes('Missing explicit deployment confirmation'), 'KS7. unconfirmed blocked')"
);

// Fix Test 32 and 33
content = content.replace(
  "// 32. Invalid budget type rejected\n  await resetDeployment();\n  (global as any).mockQueryFunc = null;\n  await db.query(\"UPDATE public.unified_campaigns SET budget_type='monthly' WHERE id=$1\", [campId]);",
  "// 32. Invalid budget type rejected\n  await resetDeployment();\n  (global as any).mockQueryFunc = async function(q: string) { if (q.includes('customer.test_account')) return [{ customer: { id: 123, test_account: true } }]; return '__FALLTHROUGH__'; };\n  await db.query(\"UPDATE public.unified_campaigns SET budget_type='monthly' WHERE id=$1\", [campId]);"
);

content = content.replace(
  "// 33. Tampered max_auto_budget_increase rejected\n  await resetDeployment();\n  (global as any).mockQueryFunc = null;\n  await db.query(\"UPDATE public.unified_campaigns SET budget_type='DAILY', max_auto_budget_increase=true WHERE id=$1\", [campId]);",
  "// 33. Tampered max_auto_budget_increase rejected\n  await resetDeployment();\n  (global as any).mockQueryFunc = async function(q: string) { if (q.includes('customer.test_account')) return [{ customer: { id: 123, test_account: true } }]; return '__FALLTHROUGH__'; };\n  await db.query(\"UPDATE public.unified_campaigns SET budget_type='DAILY', max_auto_budget_increase=true WHERE id=$1\", [campId]);"
);

// We need to fix Test 8 too if it uses `mockQueryFunc = null`
content = content.replace(
  "// 8. Target-state mismatch rejected\n  await resetDeployment();\n  (global as any).mockQueryFunc = null;\n  await db.query(\"UPDATE public.unified_campaigns SET budget_amount=500 WHERE id=$1\", [campId]);",
  "// 8. Target-state mismatch rejected\n  await resetDeployment();\n  (global as any).mockQueryFunc = async function(q: string) { if (q.includes('customer.test_account')) return [{ customer: { id: 123, test_account: true } }]; return '__FALLTHROUGH__'; };\n  await db.query(\"UPDATE public.unified_campaigns SET budget_amount=500 WHERE id=$1\", [campId]);"
);

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', content);
