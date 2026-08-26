const fs = require('fs');
let code = fs.readFileSync('src/lib/providers/google/reconciliation.ts', 'utf-8');
code = code.replace(
  "hasDrift = true; differences.push('Keyword does not belong to verified customer'); break;",
  "console.log('TEST40 TRIGGER kwRes length:', kwRes.length, 'r.customer:', r.customer?.id?.toString(), 'verified:', verifiedCustomerNum); hasDrift = true; differences.push('Keyword does not belong to verified customer'); break;"
);
fs.writeFileSync('src/lib/providers/google/reconciliation.ts', code);
