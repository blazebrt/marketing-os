const fs = require('fs');
let c = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

c = c.replace(/headlines: \[\{text: 'h1'\}, \{text: 'h2'\}\]/g, "headlines: [{text: 'h1'}]");
c = c.replace(/descriptions: \[\{text: 'd1'\}, \{text: 'd2'\}\]/g, "descriptions: [{text: 'd1'}]");

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', c);
