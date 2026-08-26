const fs = require('fs');
let text = fs.readFileSync('src/lib/providers/google/reconciliation.ts', 'utf-8');
text = text.replace(
  "console.log('RECONCILE CRASH:', err.message); const sanitizedMsg = err.message ? err.message.replace(/secret|token|password/gi, 'REDACTED') : 'Unknown error';",
  "console.log('RECONCILE CRASH:', err.stack); const sanitizedMsg = err.message ? err.message.replace(/secret|token|password/gi, 'REDACTED') : 'Unknown error';"
);
fs.writeFileSync('src/lib/providers/google/reconciliation.ts', text);
