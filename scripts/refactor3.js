const fs = require('fs');

const gateCode = `import { GoogleProviderError } from './errors';

export function authorizeGoogleTestMutation(
  verifiedCustomerId: string,
  authenticatedUid: string,
  deploymentStatus: string,
  deployment: any,
  targetState: any
) {
  if (process.env.GOOGLE_ADS_EXECUTION_MODE !== 'test') {
    throw new GoogleProviderError('REAL_TEST_MUTATION_NOT_AUTHORIZED', 'Execution mode must be exactly "test".');
  }
  if (process.env.GOOGLE_ADS_ALLOW_MUTATIONS !== 'true') {
    throw new GoogleProviderError('REAL_TEST_MUTATION_NOT_AUTHORIZED', 'Mutations are explicitly disabled.');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new GoogleProviderError('REAL_TEST_MUTATION_NOT_AUTHORIZED', 'Test mutations cannot run in a production environment.');
  }
  if (verifiedCustomerId !== process.env.GOOGLE_ADS_TEST_CUSTOMER_ID) {
    throw new GoogleProviderError('REAL_TEST_MUTATION_NOT_AUTHORIZED', 'Verified customer ID does not match configured test customer ID.');
  }
  if (!authenticatedUid) {
    throw new GoogleProviderError('REAL_TEST_MUTATION_NOT_AUTHORIZED', 'Anonymous user is not authorized.');
  }
  if (deployment.owner_id !== authenticatedUid) {
    throw new GoogleProviderError('REAL_TEST_MUTATION_NOT_AUTHORIZED', 'Wrong owner for deployment.');
  }
  if (process.env.GOOGLE_ADS_DEPLOYMENT_CONFIRMATION !== 'CONFIRMED') {
    throw new GoogleProviderError('REAL_TEST_MUTATION_NOT_AUTHORIZED', 'Missing explicit deployment confirmation.');
  }
  if (deploymentStatus !== 'READY_TO_DEPLOY') {
    throw new GoogleProviderError('REAL_TEST_MUTATION_NOT_AUTHORIZED', 'Deployment must be in READY_TO_DEPLOY state.');
  }

  const allCreatives = [...(targetState.headlines || []), ...(targetState.descriptions || []), ...(targetState.keywords || [])];
  for (const item of allCreatives) {
    if (item.rejected || item.owner_approved !== true) {
      throw new GoogleProviderError('REAL_TEST_MUTATION_NOT_AUTHORIZED', 'Unapproved or rejected creative found in target state.');
    }
  }

  return true;
}
`;

fs.writeFileSync('src/lib/providers/google/mutation-gate.ts', gateCode);

let depCode = fs.readFileSync('src/lib/providers/google/deployment.ts', 'utf8');

// Remove inline `export function authorizeGoogleTestMutation`
depCode = depCode.replace(/export function authorizeGoogleTestMutation[\s\S]*?\}\n\n/, '');

// Add import
depCode = `import { authorizeGoogleTestMutation } from './mutation-gate';\n` + depCode;

// Fix lock query to ONLY allow READY_TO_DEPLOY so that deploymentStatus is READY_TO_DEPLOY
depCode = depCode.replace(/\.in\('status', \['READY_TO_DEPLOY', 'FAILED'\]\)/g, `.eq('status', 'READY_TO_DEPLOY')`);

// Remove inline authorizeGoogleTestMutation(verifiedCustomerId);
depCode = depCode.replace(/authorizeGoogleTestMutation\(verifiedCustomerId\);\n/g, '');

// Insert authorization right after fetch credentials
depCode = depCode.replace(
  /const limits = calculateSafetyLimits\(budgetTypeStr, budgetAmount, durationDays\);/,
  `const limits = calculateSafetyLimits(budgetTypeStr, budgetAmount, durationDays);

    authorizeGoogleTestMutation(verifiedCustomerId, authenticatedUid, 'READY_TO_DEPLOY', deployment, targetState);
`
);

fs.writeFileSync('src/lib/providers/google/deployment.ts', depCode);
