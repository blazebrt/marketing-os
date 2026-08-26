const fs = require('fs');
let c = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf8');

// 45A: change assertion - we now assert no originalError in details AND that it throws
c = c.replace(
  /assert\(e\.details\?\.originalError\?\.includes\('Unauthorized'\), '45A\. Anonymous reconciliation rejected'\);/g,
  "assert(!e.details?.originalError, '45A. Anonymous reconciliation does not expose originalError'); assert(e.code === 'GOOGLE_INTERNAL_ERROR', '45A. Anonymous reconciliation rejected');"
);

// 45B: same
c = c.replace(
  /assert\(e\.details\?\.originalError\?\.includes\('Unauthorized'\), '45B\. Owner A reconciling Owner B rejected'\);/g,
  "assert(!e.details?.originalError, '45B. Owner mismatch does not expose originalError'); assert(e.code === 'GOOGLE_INTERNAL_ERROR', '45B. Owner A reconciling Owner B rejected');"
);

// 45C: same
c = c.replace(
  /assert\(e\.details\?\.originalError\?\.includes\('Unauthorized'\), '45C\. Spoofed ownerId rejected'\);/g,
  "assert(!e.details?.originalError, '45C. Spoofed ownerId does not expose originalError'); assert(e.code === 'GOOGLE_INTERNAL_ERROR', '45C. Spoofed ownerId rejected');"
);

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', c);
