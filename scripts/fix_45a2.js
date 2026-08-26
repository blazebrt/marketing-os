const fs = require('fs');

let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

content = content.replace(
  "assert(e.message.includes('Unauthorized'), '45A. Anonymous reconciliation rejected');",
  "assert(e.details?.originalError?.includes('Unauthorized'), '45A. Anonymous reconciliation rejected');"
);
content = content.replace(
  "assert(e.message.includes('Unauthorized'), '45B. Owner A reconciling Owner B rejected');",
  "assert(e.details?.originalError?.includes('Unauthorized'), '45B. Owner A reconciling Owner B rejected');"
);
content = content.replace(
  "assert(e.message.includes('Unauthorized'), '45C. Spoofed ownerId rejected');",
  "assert(e.details?.originalError?.includes('Unauthorized'), '45C. Spoofed ownerId rejected');"
);

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', content);
