const fs = require('fs');

let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

content = content.replace("assert(!e.originalError, '38. originalError removed');", "assert(!e.details?.originalError, '38. originalError removed');\n     assert(!JSON.stringify(e.details || {}).includes('yolo'), '38. yolo not in details');");

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', content);
