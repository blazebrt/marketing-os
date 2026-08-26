const fs = require('fs');
let code = fs.readFileSync('src/lib/providers/google/reconciliation.ts', 'utf-8');

code = code.replace(
  "import { createServiceClient } from '../../supabase/service';",
  "import { createServiceClient } from '../../supabase/service';\nimport { createClient } from '../../supabase/server';"
);

const newStart = `export async function reconcileGoogleDeployment(campaignId: string, ownerId: string) {
  const browserClient = await createClient();
  const { data: { user } } = await browserClient.auth.getUser();
  if (!user || user.id !== ownerId) {
    throw new GoogleProviderError(ERROR_CODES.AUTH_FAILED, 'Unauthorized to reconcile this deployment.');
  }
  const authenticatedUid = user.id;
  const supabase = await createServiceClient();`;

code = code.replace(
  "export async function reconcileGoogleDeployment(campaignId: string, ownerId: string) {\n  const supabase = await createServiceClient();",
  newStart
);

code = code.replace(/ownerId/g, 'authenticatedUid');
// Except we need to revert the function signature parameter 'ownerId'
code = code.replace('export async function reconcileGoogleDeployment(campaignId: string, authenticatedUid: string)', 'export async function reconcileGoogleDeployment(campaignId: string, ownerId: string)');

fs.writeFileSync('src/lib/providers/google/reconciliation.ts', code);
