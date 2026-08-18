import { GoogleProviderError } from './errors';

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
