const fs = require('fs');
let text = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');
text = text.replace(
  "ORDER BY created_at DESC LIMIT 1",
  "LIMIT 1"
);
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', text);
