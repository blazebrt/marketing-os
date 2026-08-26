const fs = require('fs');
let code = fs.readFileSync('src/lib/providers/google/test-account.ts', 'utf-8');
code = code.replace(
  "'Failed to verify test account status.',\n      {}",
  "'Failed to verify test account status.'"
);
fs.writeFileSync('src/lib/providers/google/test-account.ts', code);
