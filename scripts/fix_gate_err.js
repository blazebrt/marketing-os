const fs = require('fs');
let code = fs.readFileSync('src/lib/providers/google/mutation-gate.ts', 'utf8');
code = code.replace(/throw new GoogleProviderError\('REAL_TEST_MUTATION_NOT_AUTHORIZED',\s*'verifyTestAccount failed: '\s*\+\s*err\.message\);/g, 
  "throw new GoogleProviderError('REAL_TEST_MUTATION_NOT_AUTHORIZED', 'Test-account verification failed.');");
fs.writeFileSync('src/lib/providers/google/mutation-gate.ts', code);
