const fs = require('fs');
let code = fs.readFileSync('src/lib/providers/google/test-account.ts', 'utf-8');
code = code.replace(
  "{ originalError: err.message }",
  "{}"
);
fs.writeFileSync('src/lib/providers/google/test-account.ts', code);
