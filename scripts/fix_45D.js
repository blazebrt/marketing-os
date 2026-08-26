const fs = require('fs');

let content = fs.readFileSync('tests/milestone6_comprehensive.test.ts', 'utf-8');

const target = `  await resetDeployment();
  let reconRes = await reconcileGoogleDeployment(campId, ownerA);
  assert(reconRes.status === 'MATCH', '45D. Correct authenticated owner succeeds');`;

const replacement = `  await resetDeployment('READY_TO_DEPLOY', targetState, { 
    campaignBudgetResourceName: 'MKTOS-d1-BUDGET', 
    campaignResourceName: 'MKTOS-d1-CAMPAIGN', 
    adGroupResourceName: 'MKTOS-d1-ADGROUP' 
  });
  let reconRes = await reconcileGoogleDeployment(campId, ownerA);
  assert(reconRes.status === 'MATCH', '45D. Correct authenticated owner succeeds');`;

content = content.replace(target, replacement);

fs.writeFileSync('tests/milestone6_comprehensive.test.ts', content);
