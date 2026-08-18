import { GoogleProviderError } from './errors';
import { verifyTestAccount } from './test-account';
import { decryptCredential } from '../../crypto';

export async function authorizeGoogleTestMutation(
  authenticatedUid: string,
  deploymentStatus: string,
  deployment: any,
  targetState: any,
  refreshToken: string
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

  // verifyTestAccount() succeeds & Google customer.test_account === true
  let verifiedCustomerId: string;
  try {
    verifiedCustomerId = await verifyTestAccount(
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      refreshToken,
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      process.env.GOOGLE_ADS_TEST_CUSTOMER_ID!,
      process.env.GOOGLE_ADS_TEST_MANAGER_ID!
    );
  } catch (err: any) {
    throw new GoogleProviderError('REAL_TEST_MUTATION_NOT_AUTHORIZED', 'verifyTestAccount failed: ' + err.message);
  }

  // verified customer === GOOGLE_ADS_TEST_CUSTOMER_ID
  if (verifiedCustomerId !== process.env.GOOGLE_ADS_TEST_CUSTOMER_ID) {
    throw new GoogleProviderError('REAL_TEST_MUTATION_NOT_AUTHORIZED', 'Verified customer ID does not match configured test customer ID.');
  }

  return verifiedCustomerId;
}
