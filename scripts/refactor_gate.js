const fs = require('fs');
let c = fs.readFileSync('src/lib/providers/google/deployment.ts', 'utf8');

const regex = /\/\/\s*REAL EXECUTION AUTHORIZATION BOUNDARY[\s\S]*?\/\/\s*Note: verifyTestAccount already strictly ensures test_account === true\./m;

const replacement = 'authorizeGoogleTestMutation(verifiedCustomerId);';

c = c.replace(regex, replacement);

const func = `export function authorizeGoogleTestMutation(verifiedCustomerId: string) {
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
  if (process.env.GOOGLE_ADS_DEPLOYMENT_CONFIRMATION !== 'CONFIRMED') {
    throw new GoogleProviderError('REAL_TEST_MUTATION_NOT_AUTHORIZED', 'Missing explicit deployment confirmation.');
  }
}

`;

c = c.replace(/export async function deployGoogleCampaign/, func + 'export async function deployGoogleCampaign');

fs.writeFileSync('src/lib/providers/google/deployment.ts', c);
