const fs = require('fs');
let code = fs.readFileSync('src/lib/providers/google/reconciliation.ts', 'utf-8');
code = code.replace(
  "return { status, differences };",
  "console.log('RECON STATUS:', status, differences); return { status, differences };"
);
fs.writeFileSync('src/lib/providers/google/reconciliation.ts', code);
