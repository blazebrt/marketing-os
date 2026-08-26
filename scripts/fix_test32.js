const fs = require('fs');

let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

content = content.replace(
  "// 32. INVALID BUDGET TYPE\n  await resetDeployment();",
  "// 32. INVALID BUDGET TYPE\n  (global as any).mockQueryFunc = async function(q: string) { if (q.includes('customer.test_account')) return [{ customer: { id: 123, test_account: true } }]; return '__FALLTHROUGH__'; };\n  await resetDeployment();"
);

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', content);
