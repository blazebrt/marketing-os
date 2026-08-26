const fs = require('fs');

let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

const oldMock = `          if (q.includes('responsive_search_ad.headlines')) { if (existingRemoteResources.forceHeadlineDrift) return [{ ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'H1_WRONG'}], descriptions: [{text: 'D1'}] }, final_urls: ['https://a.com'] } }, customer: { id: 123 } }]; return [{ ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'H1'}], descriptions: [{text: 'D1'}] }, final_urls: ['https://a.com'] } }, customer: { id: 123 } }]; }`;

const newMock = `          if (q.includes('responsive_search_ad.headlines')) { 
            const adGroupRes = existingRemoteResources.adGroup || mutatedResources.find(m => m.entity === 'ad_group')?.resource?.resource_name;
            if (existingRemoteResources.forceHeadlineDrift) return [{ ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'H1_WRONG'}], descriptions: [{text: 'D1'}] }, final_urls: ['https://a.com'] } }, customer: { id: 123 }, ad_group: { resource_name: adGroupRes } }]; 
            return [{ ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'H1'}], descriptions: [{text: 'D1'}] }, final_urls: ['https://a.com'] } }, customer: { id: 123 }, ad_group: { resource_name: adGroupRes } }]; 
          }`;

content = content.replace(oldMock, newMock);
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', content);
