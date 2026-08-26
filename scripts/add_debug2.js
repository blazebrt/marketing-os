const fs = require('fs');
let code = fs.readFileSync('src/lib/providers/google/reconciliation.ts', 'utf-8');
code = code.replace(
  "let hasDrift = false;",
  "console.log('KWRES LENGTH:', kwRes.length); let hasDrift = false;"
);
fs.writeFileSync('src/lib/providers/google/reconciliation.ts', code);
