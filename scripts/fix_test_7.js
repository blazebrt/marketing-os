const fs = require('fs');
let code = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');
code = code.replace(/GOOGLE_RECONCILIATION_COMPLETED/g, 'GOOGLE_DEPLOYMENT_FAILED');
code = code.replace(/details\.after\.differences/g, 'details.after.error');
code = code.replace(/diffs\.includes\('HEADLINE_MISMATCH'\)/g, "diffs.includes('DRIFT')");
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', code);
