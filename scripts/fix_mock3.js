const fs = require('fs');
let text = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');
text = text.replace(
  "if (q.includes('ad_group_criterion.keyword.text')) return [{ ad_group_criterion: { keyword: { text: 'K1', match_type: 'EXACT' } }, customer: { id: 1234567890 } }];",
  "if (q.includes('ad_group_criterion.keyword.text')) return [{ ad_group_criterion: { keyword: { text: 'K1', match_type: 'EXACT' } }, customer: { id: 1234567890 } }];\n    return [];"
);
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', text);
