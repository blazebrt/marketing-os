const fs = require('fs');
let code = fs.readFileSync('src/lib/providers/google/deployment.ts', 'utf-8');
code = code.replace(
  "const reconciliationResult = await reconcileGoogleDeployment(campaignId, authenticatedUid);",
  "console.log('STARTING RECONCILIATION GATE'); const reconciliationResult = await reconcileGoogleDeployment(campaignId, authenticatedUid); console.log('RECONCILIATION RESULT:', reconciliationResult);"
);
fs.writeFileSync('src/lib/providers/google/deployment.ts', code);
