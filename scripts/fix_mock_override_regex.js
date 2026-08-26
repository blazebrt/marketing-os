const fs = require('fs');
let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');
content = content.replace(
  /async query\(q: string\) \{/,
  "async query(q: string) {\n          if (typeof (global as any).mockQueryFunc === 'function') {\n            const res = await (global as any).mockQueryFunc(q);\n            if (res !== '__FALLTHROUGH__') return res;\n          }"
);
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', content);
