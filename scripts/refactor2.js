const fs = require('fs');
let c = fs.readFileSync('src/lib/providers/google/deployment.ts', 'utf8');

c = c.replace(/export function authorizeGoogleTestMutation[\s\S]*?\}\n\n/, '');
c = "import { authorizeGoogleTestMutation } from './mutation-gate';\n" + c;

// Move `await authorizeGoogleTestMutation(verifiedCustomerId, ownerId, authenticatedUid, deployment.status, deployment, targetState);`
// to right after lock acquisition.
c = c.replace('authorizeGoogleTestMutation(verifiedCustomerId);', '');
c = c.replace(/await acquireDeploymentLock\(campaignId\);/, "await acquireDeploymentLock(campaignId);\n    await authorizeGoogleTestMutation(verifiedCustomerId, authenticatedUid, authenticatedUid, deployment.status, deployment, targetState);");

fs.writeFileSync('src/lib/providers/google/deployment.ts', c);
