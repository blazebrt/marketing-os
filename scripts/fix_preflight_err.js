const fs = require('fs');
let code = fs.readFileSync('scripts/google_preflight.ts', 'utf8');
code = code.replace(/throw new Error\('FAIL CLOSED: Preflight failed: ' \+ err\.message\);/g, 
  "throw new Error('PREFLIGHT_FAILED');");
fs.writeFileSync('scripts/google_preflight.ts', code);
