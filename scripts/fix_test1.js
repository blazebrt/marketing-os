const fs = require('fs');

let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

const target1 = `  // Test 1: Concurrent lock
  await resetDeployment();
  (global as any).mockQueryFunc = async function(q: string) {
    if (q.includes('campaign_budget.amount_micros')) return [{ campaign_budget: { amount_micros: 1000000000 }, customer: { id: 1234567890 } }];
    if (q.includes('campaign.bidding_strategy_type')) return [{ campaign: { bidding_strategy_type: 'MAXIMIZE_CONVERSIONS' }, campaign_budget: { resource_name: 'MKTOS-d1-BUDGET' }, customer: { id: 1234567890 } }];
    if (q.includes('ad_group.name')) return [{ ad_group: { name: 'AG1' }, campaign: { resource_name: 'MKTOS-d1-CAMPAIGN' }, customer: { id: 1234567890 } }];
    if (q.includes('responsive_search_ad')) return [{ 
      ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'h1'}, {text: 'h2'}], descriptions: [{text: 'd1'}, {text: 'd2'}] }, final_urls: ['https://a.com'] } },
      customer: { id: 1234567890 },
      ad_group: { resource_name: 'MKTOS-d1-ADGROUP' }
    }];
    if (q.includes('ad_group_criterion')) return [{ ad_group_criterion: { resource_name: 'kw1', keyword: { text: 'k1', match_type: 'EXACT' } }, customer: { id: 1234567890 } }];
    return '__FALLTHROUGH__';
  };`;

const replacement1 = `  // Test 1: Concurrent lock
  await resetDeployment();
  (global as any).mockQueryFunc = async function(q: string) {
    return '__FALLTHROUGH__';
  };`;

content = content.replace(target1, replacement1);

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', content);
