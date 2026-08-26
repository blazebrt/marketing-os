const fs = require('fs');
let code = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');
code = code.split('\n').filter(l => !l.includes("if (q.includes('ad_group.name') && !q.includes('ad_group.type'))")).join('\n');
code = code.split('\n').filter(l => !l.includes("if (q.includes('responsive_search_ad.headlines')) return [{ ad_group_ad: { ad: { final_urls: ['https://a.com'], responsive_search_ad: { headlines: [{text: 'H1'}] } } } }];")).join('\n');
code = code.split('\n').filter(l => !l.includes("if (q.includes('ad_group_criterion.keyword.text')) return [{ ad_group_criterion: { keyword: { text: 'K1', match_type: 'EXACT' } } }];")).join('\n');
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', code);
