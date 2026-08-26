const fs = require('fs');

let depCode = fs.readFileSync('src/lib/providers/google/deployment.ts', 'utf8');

// Replace the old test account verification and gate check with the new combined one
depCode = depCode.replace(/\/\/ 4\. verifyTestAccount[\s\S]*?authorizeGoogleTestMutation\(verifiedCustomerId, authenticatedUid, 'READY_TO_DEPLOY', deployment, targetState\);/, `
    // 4. Authorize Mutation Gate
    const verifiedCustomerId = await authorizeGoogleTestMutation(
      authenticatedUid,
      'READY_TO_DEPLOY',
      deployment,
      targetState,
      refreshToken
    );
`);

fs.writeFileSync('src/lib/providers/google/deployment.ts', depCode);
