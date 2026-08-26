const fs = require('fs');
let code = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');
code = code.replace(
  "if (q.includes('responsive_search_ad.headlines')) return [{ ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'H1'}], descriptions: [{text: 'D1'}] }, final_urls: ['https://a.com'] } }, customer: { id: 123 } }];",
  "if (q.includes('responsive_search_ad.headlines')) { if (existingRemoteResources.forceHeadlineDrift) return [{ ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'H1_WRONG'}], descriptions: [{text: 'D1'}] }, final_urls: ['https://a.com'] } }, customer: { id: 123 } }]; return [{ ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'H1'}], descriptions: [{text: 'D1'}] }, final_urls: ['https://a.com'] } }, customer: { id: 123 } }]; }"
);
code = code.replace(
  "existingRemoteResources = { budget: 'b1', campaign: 'c1', adGroup: 'ag1', ad: 'ad1', keyword: 'kw1' };",
  "existingRemoteResources = { budget: 'b1', campaign: 'c1', adGroup: 'ag1', ad: 'ad1', keyword: 'kw1', forceHeadlineDrift: true };"
);
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', code);
