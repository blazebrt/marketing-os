const fs = require('fs');
let code = fs.readFileSync('src/lib/providers/google/reconciliation.ts', 'utf-8');
code = code.replace(
  "if (!user || user.id !== authenticatedUid) {",
  "if (!user || user.id !== ownerId) {"
);
fs.writeFileSync('src/lib/providers/google/reconciliation.ts', code);
