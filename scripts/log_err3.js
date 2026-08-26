const fs = require('fs');
let code = fs.readFileSync('src/lib/providers/google/reconciliation.ts', 'utf-8');
code = code.replace(
  "throw new GoogleProviderError(ERROR_CODES.INTERNAL_ERROR, 'Failed to reconcile', { originalError: sanitizedMsg });",
  "console.log('RECONCILE CRASH:', err.stack); throw new GoogleProviderError(ERROR_CODES.INTERNAL_ERROR, 'Failed to reconcile', { originalError: sanitizedMsg });"
);
fs.writeFileSync('src/lib/providers/google/reconciliation.ts', code);
