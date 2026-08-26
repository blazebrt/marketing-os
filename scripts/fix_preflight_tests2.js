const fs = require('fs');
let code = fs.readFileSync('tests/milestone6_preflight.test.ts', 'utf8');

code = code.replace(
  /assert\(e\.message\.includes\('exceeds safety limits'\) \|\| e\.message\.includes\('above'\), '16\. invalid budget -> rejected'\);/g,
  "assert(e.message.includes('exceeds safety limit') || e.message.includes('above'), '16. invalid budget -> rejected');"
);

// For Test 20, let's mock the server client so it doesn't throw the cookies error
code = code.replace(
  /\/\/ 20\. failed reconciliation never becomes ACTIVE/g,
  `
  // Mock supabase server
  const { __setMockCreateClient } = require('../src/lib/supabase/server');
  __setMockCreateClient(async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user1' } } }) } }));
  // 20. failed reconciliation never becomes ACTIVE`
);

fs.writeFileSync('tests/milestone6_preflight.test.ts', code);
