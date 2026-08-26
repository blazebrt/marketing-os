const fs = require('fs');
let code = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

const regex = /if \(q\.includes\('bidding_strategy_type'\)\) return \[\{ campaign: \{ name: 'Test', bidding_strategy_type: 'MANUAL_CPC' \}, campaign_budget: \{ amount_micros: 1000 \* 1000000 \} \}\];\s*if \(q\.includes\('ad_group\.type'\)\) return \[\{ ad_group: \{ name: 'AG1' \}, campaign: \{ resource_name: existingRemoteResources\.campaign \|\| mutatedResources\.find\(m => m\.entity === 'campaign'\)\?\.resource\?\.resource_name \|\| 'c1' \} \}\];/;

const replacement = `if (q.includes('campaign_budget.amount_micros')) return [{ campaign_budget: { amount_micros: 1000 * 1000000 }, customer: { id: 123 } }];
          if (q.includes('bidding_strategy_type')) return [{ campaign: { bidding_strategy_type: 'MANUAL_CPC' }, campaign_budget: { resource_name: existingRemoteResources.budget || mutatedResources.find(m => m.entity === 'campaign_budget')?.resource?.resource_name }, customer: { id: 123 } }];
          if (q.includes('ad_group.name')) return [{ ad_group: { name: 'AG1' }, campaign: { resource_name: existingRemoteResources.campaign || mutatedResources.find(m => m.entity === 'campaign')?.resource?.resource_name }, customer: { id: 123 } }];
          if (q.includes('responsive_search_ad.headlines')) return [{ ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'H1'}], descriptions: [{text: 'D1'}] }, final_urls: ['https://a.com'] } }, customer: { id: 123 } }];
          if (q.includes('ad_group_criterion.keyword.text')) return [{ ad_group_criterion: { keyword: { text: 'K1', match_type: 'EXACT' } }, customer: { id: 123 } }];`;

if (!regex.test(code)) {
  console.error("REGEX DID NOT MATCH!");
} else {
  code = code.replace(regex, replacement);
  fs.writeFileSync('tests/milestone6_comprehensive.test.ts', code);
  console.log("REPLACED SUCCESSFULLY");
}
