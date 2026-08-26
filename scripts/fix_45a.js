const fs = require('fs');
let c = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');
c = c.replace(
  "catch(e: any) { assert(e.message.includes('Unauthorized'), '45A. Anonymous reconciliation rejected'); }",
  "catch(e: any) { console.error('45A ERROR:', e); assert(e.message.includes('Unauthorized'), '45A. Anonymous reconciliation rejected'); }"
);
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', c);
