const fs = require('fs');
let c = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

c = c.replace(/process\.env\.GOOGLE_ADS_EXECUTION_MODE = 'test';/, `
  process.env.GOOGLE_ADS_EXECUTION_MODE = 'test';
  process.env.GOOGLE_ADS_ALLOW_MUTATIONS = 'true';
  process.env.GOOGLE_ADS_DEPLOYMENT_CONFIRMATION = 'CONFIRMED';
  process.env.NODE_ENV = 'test';
`);

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', c);
