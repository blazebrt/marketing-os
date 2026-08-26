const fs = require('fs');
let code = fs.readFileSync('src/lib/providers/google/reconciliation.ts', 'utf-8');
code = code.replace(
  "const ag = agRes[0].ad_group;\n        const c = agRes[0].campaign;",
  "console.log('agRes:', JSON.stringify(agRes)); const ag = agRes[0].ad_group;\n        const c = agRes[0].campaign;"
);
fs.writeFileSync('src/lib/providers/google/reconciliation.ts', code);
