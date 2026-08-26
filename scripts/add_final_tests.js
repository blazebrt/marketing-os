const fs = require('fs');

const addTests = `
  mockAuthUser = { id: ownerA };

  // 38. TEST ACCOUNT ERROR LEAK
  await resetDeployment();
  (global as any).mockQueryFunc = async function(q: string) {
    if (q.includes('test_account')) {
       const err = new Error("Bearer yolo-token developer_token refresh-stacktrace");
       (err as any).code = 401;
       throw err;
    }
    return [];
  };
  try { await deployGoogleCampaign(campId, ownerA); } catch(e: any) { 
     assert(!e.message.includes('yolo'), '38. Thrown error sanitized');
     assert(!e.originalError, '38. originalError removed');
  }

  // 39. KEYWORD EXACT MATCH (A)
  await resetDeployment();
  (global as any).mockQueryFunc = async function(q: string) {
    if (q.includes('campaign_budget.amount_micros')) return [{ campaign_budget: { amount_micros: 1000000000 }, customer: { id: 1234567890 } }];
    if (q.includes('campaign.bidding_strategy_type')) return [{ campaign: { bidding_strategy_type: 'MAXIMIZE_CONVERSIONS' }, campaign_budget: { resource_name: 'MKTOS-d1-BUDGET' }, customer: { id: 1234567890 } }];
    if (q.includes('ad_group.name')) return [{ ad_group: { name: 'AG1' }, campaign: { resource_name: 'MKTOS-d1-CAMPAIGN' }, customer: { id: 1234567890 } }];
    if (q.includes('responsive_search_ad')) return [{ 
      ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'h1'}, {text: 'h2'}], descriptions: [{text: 'd1'}, {text: 'd2'}] }, final_urls: ['https://a.com'] } },
      customer: { id: 1234567890 }, ad_group: { resource_name: 'MKTOS-d1-ADGROUP' }
    }];
    if (q.includes('ad_group_criterion')) return [{ ad_group_criterion: { resource_name: 'kw1', keyword: { text: 'k1', match_type: 'EXACT' } }, customer: { id: 1234567890 }, ad_group: { resource_name: 'MKTOS-d1-ADGROUP' } }];
    return [];
  };
  try { await reconcileGoogleDeployment(campId, ownerA); assert(true, '39. All keywords correct MATCH'); } catch(e: any) { assert(false, '39. All keywords correct MATCH'); }

  // 40. KEYWORD WRONG CUSTOMER (B)
  await resetDeployment();
  (global as any).mockQueryFunc = async function(q: string) {
    if (q.includes('campaign_budget.amount_micros')) return [{ campaign_budget: { amount_micros: 1000000000 }, customer: { id: 1234567890 } }];
    if (q.includes('campaign.bidding_strategy_type')) return [{ campaign: { bidding_strategy_type: 'MAXIMIZE_CONVERSIONS' }, campaign_budget: { resource_name: 'MKTOS-d1-BUDGET' }, customer: { id: 1234567890 } }];
    if (q.includes('ad_group.name')) return [{ ad_group: { name: 'AG1' }, campaign: { resource_name: 'MKTOS-d1-CAMPAIGN' }, customer: { id: 1234567890 } }];
    if (q.includes('responsive_search_ad')) return [{ 
      ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'h1'}, {text: 'h2'}], descriptions: [{text: 'd1'}, {text: 'd2'}] }, final_urls: ['https://a.com'] } },
      customer: { id: 1234567890 }, ad_group: { resource_name: 'MKTOS-d1-ADGROUP' }
    }];
    if (q.includes('ad_group_criterion')) return [{ ad_group_criterion: { resource_name: 'kw1', keyword: { text: 'k1', match_type: 'EXACT' } }, customer: { id: 999999 }, ad_group: { resource_name: 'MKTOS-d1-ADGROUP' } }];
    return [];
  };
  try { await deployGoogleCampaign(campId, ownerA); } catch(e: any) { assert(e.message.includes('reconciliation failed'), '40. Keyword wrong customer DRIFT'); }

  // 41. KEYWORD WRONG AD GROUP (C)
  await resetDeployment();
  (global as any).mockQueryFunc = async function(q: string) {
    if (q.includes('campaign_budget.amount_micros')) return [{ campaign_budget: { amount_micros: 1000000000 }, customer: { id: 1234567890 } }];
    if (q.includes('campaign.bidding_strategy_type')) return [{ campaign: { bidding_strategy_type: 'MAXIMIZE_CONVERSIONS' }, campaign_budget: { resource_name: 'MKTOS-d1-BUDGET' }, customer: { id: 1234567890 } }];
    if (q.includes('ad_group.name')) return [{ ad_group: { name: 'AG1' }, campaign: { resource_name: 'MKTOS-d1-CAMPAIGN' }, customer: { id: 1234567890 } }];
    if (q.includes('responsive_search_ad')) return [{ 
      ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'h1'}, {text: 'h2'}], descriptions: [{text: 'd1'}, {text: 'd2'}] }, final_urls: ['https://a.com'] } },
      customer: { id: 1234567890 }, ad_group: { resource_name: 'MKTOS-d1-ADGROUP' }
    }];
    if (q.includes('ad_group_criterion')) return [{ ad_group_criterion: { resource_name: 'kw1', keyword: { text: 'k1', match_type: 'EXACT' } }, customer: { id: 1234567890 }, ad_group: { resource_name: 'WRONG_AD_GROUP' } }];
    return [];
  };
  try { await deployGoogleCampaign(campId, ownerA); } catch(e: any) { assert(e.message.includes('reconciliation failed'), '41. Keyword wrong ad group DRIFT'); }

  // 42. EXTRA KEYWORD (D)
  await resetDeployment();
  (global as any).mockQueryFunc = async function(q: string) {
    if (q.includes('campaign_budget.amount_micros')) return [{ campaign_budget: { amount_micros: 1000000000 }, customer: { id: 1234567890 } }];
    if (q.includes('campaign.bidding_strategy_type')) return [{ campaign: { bidding_strategy_type: 'MAXIMIZE_CONVERSIONS' }, campaign_budget: { resource_name: 'MKTOS-d1-BUDGET' }, customer: { id: 1234567890 } }];
    if (q.includes('ad_group.name')) return [{ ad_group: { name: 'AG1' }, campaign: { resource_name: 'MKTOS-d1-CAMPAIGN' }, customer: { id: 1234567890 } }];
    if (q.includes('responsive_search_ad')) return [{ 
      ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'h1'}, {text: 'h2'}], descriptions: [{text: 'd1'}, {text: 'd2'}] }, final_urls: ['https://a.com'] } },
      customer: { id: 1234567890 }, ad_group: { resource_name: 'MKTOS-d1-ADGROUP' }
    }];
    if (q.includes('ad_group_criterion')) return [
       { ad_group_criterion: { resource_name: 'kw1', keyword: { text: 'k1', match_type: 'EXACT' } }, customer: { id: 1234567890 }, ad_group: { resource_name: 'MKTOS-d1-ADGROUP' } },
       { ad_group_criterion: { resource_name: 'kw2', keyword: { text: 'k2', match_type: 'BROAD' } }, customer: { id: 1234567890 }, ad_group: { resource_name: 'MKTOS-d1-ADGROUP' } }
    ];
    return [];
  };
  try { await deployGoogleCampaign(campId, ownerA); } catch(e: any) { assert(e.message.includes('reconciliation failed'), '42. Extra keyword DRIFT'); }

  // 43. MISSING KEYWORD (E)
  await resetDeployment();
  (global as any).mockQueryFunc = async function(q: string) {
    if (q.includes('campaign_budget.amount_micros')) return [{ campaign_budget: { amount_micros: 1000000000 }, customer: { id: 1234567890 } }];
    if (q.includes('campaign.bidding_strategy_type')) return [{ campaign: { bidding_strategy_type: 'MAXIMIZE_CONVERSIONS' }, campaign_budget: { resource_name: 'MKTOS-d1-BUDGET' }, customer: { id: 1234567890 } }];
    if (q.includes('ad_group.name')) return [{ ad_group: { name: 'AG1' }, campaign: { resource_name: 'MKTOS-d1-CAMPAIGN' }, customer: { id: 1234567890 } }];
    if (q.includes('responsive_search_ad')) return [{ 
      ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'h1'}, {text: 'h2'}], descriptions: [{text: 'd1'}, {text: 'd2'}] }, final_urls: ['https://a.com'] } },
      customer: { id: 1234567890 }, ad_group: { resource_name: 'MKTOS-d1-ADGROUP' }
    }];
    if (q.includes('ad_group_criterion')) return [];
    return [];
  };
  try { await deployGoogleCampaign(campId, ownerA); } catch(e: any) { assert(e.message.includes('reconciliation failed'), '43. Missing keyword DRIFT'); }

  // 44. WRONG MATCH TYPE (F)
  await resetDeployment();
  (global as any).mockQueryFunc = async function(q: string) {
    if (q.includes('campaign_budget.amount_micros')) return [{ campaign_budget: { amount_micros: 1000000000 }, customer: { id: 1234567890 } }];
    if (q.includes('campaign.bidding_strategy_type')) return [{ campaign: { bidding_strategy_type: 'MAXIMIZE_CONVERSIONS' }, campaign_budget: { resource_name: 'MKTOS-d1-BUDGET' }, customer: { id: 1234567890 } }];
    if (q.includes('ad_group.name')) return [{ ad_group: { name: 'AG1' }, campaign: { resource_name: 'MKTOS-d1-CAMPAIGN' }, customer: { id: 1234567890 } }];
    if (q.includes('responsive_search_ad')) return [{ 
      ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'h1'}, {text: 'h2'}], descriptions: [{text: 'd1'}, {text: 'd2'}] }, final_urls: ['https://a.com'] } },
      customer: { id: 1234567890 }, ad_group: { resource_name: 'MKTOS-d1-ADGROUP' }
    }];
    if (q.includes('ad_group_criterion')) return [{ ad_group_criterion: { resource_name: 'kw1', keyword: { text: 'k1', match_type: 'BROAD' } }, customer: { id: 1234567890 }, ad_group: { resource_name: 'MKTOS-d1-ADGROUP' } }];
    return [];
  };
  try { await deployGoogleCampaign(campId, ownerA); } catch(e: any) { assert(e.message.includes('reconciliation failed'), '44. Wrong match type DRIFT'); }

  // 45. INTERNAL RECONCILIATION AUTH
  // A. Anonymous
  mockAuthUser = null;
  try { await reconcileGoogleDeployment(campId, ownerA); assert(false, '45A'); } catch(e: any) { assert(e.message.includes('Unauthorized'), '45A. Anonymous reconciliation rejected'); }
  
  // B. Owner A reconciling Owner B
  mockAuthUser = { id: ownerA };
  try { await reconcileGoogleDeployment(campId, ownerB); assert(false, '45B'); } catch(e: any) { assert(e.message.includes('Unauthorized'), '45B. Owner A reconciling Owner B rejected'); }
  
  // C. Spoofed ownerId
  mockAuthUser = { id: 'random-uuid' };
  try { await reconcileGoogleDeployment(campId, ownerA); assert(false, '45C'); } catch(e: any) { assert(e.message.includes('Unauthorized'), '45C. Spoofed ownerId rejected'); }

  // D. Correct authenticated succeeds
  mockAuthUser = { id: ownerA };
  (global as any).mockQueryFunc = async function(q: string) {
    if (q.includes('campaign_budget.amount_micros')) return [{ campaign_budget: { amount_micros: 1000000000 }, customer: { id: 1234567890 } }];
    if (q.includes('campaign.bidding_strategy_type')) return [{ campaign: { bidding_strategy_type: 'MAXIMIZE_CONVERSIONS' }, campaign_budget: { resource_name: 'MKTOS-d1-BUDGET' }, customer: { id: 1234567890 } }];
    if (q.includes('ad_group.name')) return [{ ad_group: { name: 'AG1' }, campaign: { resource_name: 'MKTOS-d1-CAMPAIGN' }, customer: { id: 1234567890 } }];
    if (q.includes('responsive_search_ad')) return [{ 
      ad_group_ad: { ad: { responsive_search_ad: { headlines: [{text: 'h1'}, {text: 'h2'}], descriptions: [{text: 'd1'}, {text: 'd2'}] }, final_urls: ['https://a.com'] } },
      customer: { id: 1234567890 }, ad_group: { resource_name: 'MKTOS-d1-ADGROUP' }
    }];
    if (q.includes('ad_group_criterion')) return [{ ad_group_criterion: { resource_name: 'kw1', keyword: { text: 'k1', match_type: 'EXACT' } }, customer: { id: 1234567890 }, ad_group: { resource_name: 'MKTOS-d1-ADGROUP' } }];
    return [];
  };
  await resetDeployment();
  let reconRes = await reconcileGoogleDeployment(campId, ownerA);
  assert(reconRes.status === 'MATCH', '45D. Correct authenticated owner succeeds');

  if (failCount > 0) process.exit(1);
`;

let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');
content = content.replace('  if (failCount > 0) process.exit(1);', addTests);
fs.writeFileSync('tests/milestone6_comprehensive.test.ts', content);

