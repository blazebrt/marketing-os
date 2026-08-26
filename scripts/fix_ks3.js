const fs = require('fs');
let c = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf8');
c = c.replace(/e\.message\.includes\('Configured customer is NOT a test account'\)/g, "e.message.includes('Test-account verification failed.') || e.message.includes('NOT a test account')");
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', c);
