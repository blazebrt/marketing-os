const fs = require('fs');
let c = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

c = c.replace(/Object\.defineProperty\(process\.env, 'NODE_ENV', \{ value: '(.*?)' \}\);/g, "(process.env as any).NODE_ENV = '$1';");

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', c);
