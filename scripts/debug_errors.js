const fs = require('fs');

let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

content = content.replace(
  /assert\(e\.message\.includes\((.*?)\), (.*?)\)/g,
  "if (!e.message.includes($1)) console.error('FAILED ASSERTION: expected ' + $1 + ' but got: ' + e.message + ' (Full: ' + JSON.stringify(e) + ')'); assert(e.message.includes($1), $2)"
);

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', content);
