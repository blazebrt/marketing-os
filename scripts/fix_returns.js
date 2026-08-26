const fs = require('fs');
let c = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');
c = c.replace(/return \[\];\n  };/g, "return '__FALLTHROUGH__';\n  };");
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', c);
