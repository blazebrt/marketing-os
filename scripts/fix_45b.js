const fs = require('fs');

let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');
content = content.replace(
  "assert(e.details?.originalError?.includes('Unauthorized'), '45B. Owner A reconciling Owner B rejected');",
  "console.error('45B ERROR:', e); assert(e.details?.originalError?.includes('Unauthorized'), '45B. Owner A reconciling Owner B rejected');"
);
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', content);
