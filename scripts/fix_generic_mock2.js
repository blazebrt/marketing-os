const fs = require('fs');

let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

const oldMock = `          if (q.includes('ad_group_criterion.keyword.text')) return [{ ad_group_criterion: { keyword: { text: 'K1', match_type: 'EXACT' } }, customer: { id: 123 } }];`;
const newMock = `          if (q.includes('ad_group_criterion.keyword.text')) return [{ ad_group_criterion: { keyword: { text: 'K1', match_type: 'EXACT' } }, customer: { id: 123 }, ad_group: { resource_name: existingRemoteResources.adGroup || mutatedResources.find(m => m.entity === 'ad_group')?.resource?.resource_name } }];`;

content = content.replace(oldMock, newMock);
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', content);
