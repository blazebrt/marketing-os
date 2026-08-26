const fs = require('fs');
let code = fs.readFileSync('src/lib/providers/google/deployment.ts', 'utf-8');
code = code.replace(
  "{ error: err.message || 'Unknown error' }",
  "{ error_code: err.code || ERROR_CODES.INTERNAL_ERROR, stage: 'DEPLOYMENT' }"
);
fs.writeFileSync('src/lib/providers/google/deployment.ts', code);
