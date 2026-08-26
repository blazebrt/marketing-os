const fs = require('fs');
let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

content = content.replace(
  "if (q.includes('test_account')) return [{ customer: { test_account: true } }];",
  "if (q.includes('test_account')) return [{ customer: { id: 123, test_account: true } }];"
);

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', content);
