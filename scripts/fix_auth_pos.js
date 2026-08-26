const fs = require('fs');

let content = fs.readFileSync('src/lib/providers/google/reconciliation.ts', 'utf-8');

const targetToRemove = `  try {
    const serverClient = await createServerClient();
    const { data: authData, error: authError } = await serverClient.auth.getUser();
    if (authError || !authData?.user) throw new Error('Unauthorized: Anonymous access denied');
    if (authData.user.id !== ownerId) throw new Error('Unauthorized: Resource owner mismatch');`;

content = content.replace(targetToRemove, '  try {');

const targetToAdd = `export async function reconcileGoogleDeployment(campaignId: string, ownerId: string) {`;
const replacementToAdd = `export async function reconcileGoogleDeployment(campaignId: string, ownerId: string) {
  const serverClient = await createServerClient();
  const { data: authData, error: authError } = await serverClient.auth.getUser();
  if (authError || !authData?.user) throw new GoogleProviderError(ERROR_CODES.INTERNAL_ERROR, 'Failed to reconcile', { originalError: 'Unauthorized: Anonymous access denied' });
  if (authData.user.id !== ownerId) throw new GoogleProviderError(ERROR_CODES.INTERNAL_ERROR, 'Failed to reconcile', { originalError: 'Unauthorized: Resource owner mismatch' });`;

content = content.replace(targetToAdd, replacementToAdd);

fs.writeFileSync('src/lib/providers/google/reconciliation.ts', content);
