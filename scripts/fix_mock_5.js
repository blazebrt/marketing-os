const fs = require('fs');
let code = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');
code = code.replace(
  "        async query(q: string) {\n          if (q.includes('test_account'))",
  "        async query(q: string) {\n          if ((global as any).mockQueryFunc) { const res = await (global as any).mockQueryFunc(q); if (res) return res; }\n          if (q.includes('test_account'))"
);
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', code);
