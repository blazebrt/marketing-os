const fs = require('fs');
let c = fs.readFileSync('src/lib/providers/google/reconciliation.ts', 'utf8');
// Remove trailing comma left from removing the third argument
c = c.replace(/GoogleProviderError\(ERROR_CODES\.INTERNAL_ERROR, 'Failed to reconcile', \)/g, 
  "GoogleProviderError(ERROR_CODES.INTERNAL_ERROR, 'Failed to reconcile')");
fs.writeFileSync('src/lib/providers/google/reconciliation.ts', c);
