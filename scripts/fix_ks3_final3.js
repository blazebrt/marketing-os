const fs = require('fs');
let c = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf8');

c = c.replace(
  /assert\(e\.message\.includes\('NOT a test account'\), 'KS3\. test_account != true blocked'\);/g,
  "assert(e.message.includes('Test-account verification failed') || e.message.includes('NOT a test account'), 'KS3. test_account != true blocked');"
);

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', c);
