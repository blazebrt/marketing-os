const fs = require('fs');
let c = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

c = c.replace(/oldCreds\.rows\[0\]\.encrypted_credentials/g, "(oldCreds.rows[0] as any).encrypted_credentials");

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', c);
