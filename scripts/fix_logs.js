const fs = require('fs');
let lines = fs.readFileSync('src/lib/providers/google/reconciliation.ts', 'utf-8').split('\n');
lines[125] = '        const ag = agRes[0].ad_group;';
lines[204] = "    throw new GoogleProviderError(ERROR_CODES.INTERNAL_ERROR, 'Failed to reconcile', { originalError: sanitizedMsg });";
fs.writeFileSync('src/lib/providers/google/reconciliation.ts', lines.join('\n'));
