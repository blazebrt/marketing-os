const fs = require('fs');

const tests = `
  // 32. INVALID BUDGET TYPE
  await resetDeployment();
  await db.query("UPDATE public.unified_campaigns SET budget_type='monthly' WHERE id=$1", [campId]);
  try { await deployGoogleCampaign(campId, ownerA); } catch(e: any) { assert(e.message.includes('Budget type must be exactly'), '32. Invalid budget type rejected'); }
  await db.query("UPDATE public.unified_campaigns SET budget_type='DAILY' WHERE id=$1", [campId]);

  // 33. MAX AUTO BUDGET INCREASE
  await resetDeployment();
  await db.query("UPDATE public.unified_campaigns SET max_auto_budget_increase=true WHERE id=$1", [campId]);
  try { await deployGoogleCampaign(campId, ownerA); } catch(e: any) { assert(e.message.includes('max_auto_budget_increase must be exactly 0'), '33. Tampered max_auto_budget_increase rejected'); }
  await db.query("UPDATE public.unified_campaigns SET max_auto_budget_increase=false WHERE id=$1", [campId]);

  // 34. AUDIT ERROR SANITIZATION
  await resetDeployment();
  (global as any).mockQueryFunc = async function(q: string) {
    throw new Error("SECRET_CREDENTIAL_123");
  };
  try { await deployGoogleCampaign(campId, ownerA); } catch(e: any) {}
  let auditLog = logs.find(l => l.action === 'GOOGLE_DEPLOYMENT_FAILED');
  assert(auditLog && !JSON.stringify(auditLog).includes("SECRET_CREDENTIAL_123"), '34. Raw err.message stripped from audit log');

  // 35. EXACT AD SET RECONCILIATION - 2 ADS
  await resetDeployment();
  (global as any).mockQueryFunc = async function(q: string) {
    if (q.includes('campaign_budget.amount_micros')) return [{ campaign_budget: { amount_micros: 1000000000 }, customer: { id: 1234567890 } }];
    if (q.includes('campaign.bidding_strategy_type')) return [{ campaign: { bidding_strategy_type: 'MAXIMIZE_CONVERSIONS' }, campaign_budget: { resource_name: 'MKTOS-d1-BUDGET' }, customer: { id: 1234567890 } }];
    if (q.includes('ad_group.name')) return [{ ad_group: { name: 'AG1' }, campaign: { resource_name: 'MKTOS-d1-CAMPAIGN' }, customer: { id: 1234567890 } }];
    if (q.includes('responsive_search_ad')) return [
      { ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'h1'}, {text: 'h2'}], descriptions: [{text: 'd1'}, {text: 'd2'}] }, final_urls: ['https://a.com'] } }, customer: { id: 1234567890 }, ad_group: { resource_name: 'MKTOS-d1-ADGROUP' } },
      { ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'x'}], descriptions: [{text: 'y'}] }, final_urls: ['https://a.com'] } }, customer: { id: 1234567890 }, ad_group: { resource_name: 'MKTOS-d1-ADGROUP' } }
    ];
    if (q.includes('ad_group_criterion')) return [{ ad_group_criterion: { resource_name: 'kw1', keyword: { text: 'k1', match_type: 'EXACT' } }, customer: { id: 1234567890 } }];
    return [];
  };
  try { await deployGoogleCampaign(campId, ownerA); } catch(e: any) { assert(e.message.includes('reconciliation failed'), '35. Two ads causes DRIFT'); }

  // 36. EXACT AD SET RECONCILIATION - ZERO ADS
  await resetDeployment();
  (global as any).mockQueryFunc = async function(q: string) {
    if (q.includes('campaign_budget.amount_micros')) return [{ campaign_budget: { amount_micros: 1000000000 }, customer: { id: 1234567890 } }];
    if (q.includes('campaign.bidding_strategy_type')) return [{ campaign: { bidding_strategy_type: 'MAXIMIZE_CONVERSIONS' }, campaign_budget: { resource_name: 'MKTOS-d1-BUDGET' }, customer: { id: 1234567890 } }];
    if (q.includes('ad_group.name')) return [{ ad_group: { name: 'AG1' }, campaign: { resource_name: 'MKTOS-d1-CAMPAIGN' }, customer: { id: 1234567890 } }];
    if (q.includes('responsive_search_ad')) return [];
    if (q.includes('ad_group_criterion')) return [{ ad_group_criterion: { resource_name: 'kw1', keyword: { text: 'k1', match_type: 'EXACT' } }, customer: { id: 1234567890 } }];
    return [];
  };
  try { await deployGoogleCampaign(campId, ownerA); } catch(e: any) { assert(e.message.includes('reconciliation failed'), '36. Zero ads causes MISSING'); }

  // 37. EXACT AD SET RECONCILIATION - WRONG PARENT
  await resetDeployment();
  (global as any).mockQueryFunc = async function(q: string) {
    if (q.includes('campaign_budget.amount_micros')) return [{ campaign_budget: { amount_micros: 1000000000 }, customer: { id: 1234567890 } }];
    if (q.includes('campaign.bidding_strategy_type')) return [{ campaign: { bidding_strategy_type: 'MAXIMIZE_CONVERSIONS' }, campaign_budget: { resource_name: 'MKTOS-d1-BUDGET' }, customer: { id: 1234567890 } }];
    if (q.includes('ad_group.name')) return [{ ad_group: { name: 'AG1' }, campaign: { resource_name: 'MKTOS-d1-CAMPAIGN' }, customer: { id: 1234567890 } }];
    if (q.includes('responsive_search_ad')) return [{ 
      ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'h1'}, {text: 'h2'}], descriptions: [{text: 'd1'}, {text: 'd2'}] }, final_urls: ['https://a.com'] } },
      customer: { id: 1234567890 },
      ad_group: { resource_name: 'wrong-ad-group' }
    }];
    if (q.includes('ad_group_criterion')) return [{ ad_group_criterion: { resource_name: 'kw1', keyword: { text: 'k1', match_type: 'EXACT' } }, customer: { id: 1234567890 } }];
    return [];
  };
  try { await deployGoogleCampaign(campId, ownerA); } catch(e: any) { assert(e.message.includes('reconciliation failed'), '37. Wrong parent ad group DRIFT'); }

  if (failCount > 0) process.exit(1);
`;

let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');
content = content.replace('  if (failCount > 0) process.exit(1);', tests);
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', content);
