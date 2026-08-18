import { createServiceClient } from '../../supabase/service';
import { GoogleAdsApi } from 'google-ads-api';
import { decryptCredential } from '../../crypto';
import { GoogleProviderError, ERROR_CODES } from './errors';
import { verifyTestAccount } from './test-account';
import { GoogleTargetState } from './types';
import { logAudit } from '../../audit';

export let __MockGoogleAdsApi: any = null;
export function __setMockGoogleAdsApi(mock: any) { __MockGoogleAdsApi = mock; }

export async function reconcileGoogleDeployment(campaignId: string, ownerId: string) {
  const supabase = await createServiceClient();

  const { data: deployment, error: depError } = await supabase
    .from('channel_deployments')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('provider', 'google')
    .eq('owner_id', ownerId)
    .single();

  if (depError || !deployment) {
    throw new GoogleProviderError(ERROR_CODES.INVALID_REQUEST, 'Google deployment not found');
  }

  const { data: creds, error: credError } = await supabase
    .from('integration_credentials')
    .select('encrypted_credentials')
    .eq('owner_id', ownerId)
    .eq('provider', 'google')
    .single();

  if (credError || !creds) throw new GoogleProviderError(ERROR_CODES.AUTH_FAILED, 'Missing credentials');

  const decrypted = JSON.parse(creds.encrypted_credentials);
  const refreshToken = decryptCredential(decrypted.refresh_token);

  await verifyTestAccount(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    refreshToken,
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_ADS_TEST_CUSTOMER_ID!,
    process.env.GOOGLE_ADS_TEST_MANAGER_ID!
  );

  const ApiClass = __MockGoogleAdsApi || GoogleAdsApi;
  const client = new ApiClass({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
  });

  const customer = client.Customer({
    customer_id: process.env.GOOGLE_ADS_TEST_CUSTOMER_ID!,
    refresh_token: refreshToken,
    login_customer_id: process.env.GOOGLE_ADS_TEST_MANAGER_ID!,
  });

  const externalState = deployment.external_state || {};
  const targetState = deployment.target_state as GoogleTargetState;
  const differences: string[] = [];
  let status = 'MATCH';

  try {
    if (!externalState.campaignResourceName) {
      status = 'MISSING';
      differences.push('Campaign resource name missing in external state');
    } else {
      // Query campaign to verify
      const campResponse = await customer.query(`
        SELECT campaign.id, campaign.name, campaign.status, campaign.bidding_strategy_type, campaign_budget.amount_micros 
        FROM campaign 
        WHERE campaign.resource_name = '${externalState.campaignResourceName}'
        LIMIT 1
      `);
      if (campResponse.length === 0) {
        status = 'MISSING';
        differences.push('Campaign not found in Google Ads');
      } else {
        const camp = campResponse[0].campaign;
        const budget = campResponse[0].campaign_budget;
        if (!camp.name.includes('Test')) differences.push('Campaign name mismatch');
        if (budget.amount_micros !== targetState.campaign.budget * 1000000) {
          status = 'DRIFT';
          differences.push(`Budget mismatch. Expected ${targetState.campaign.budget * 1000000}, found ${budget.amount_micros}`);
        }
      }
    }

    if (differences.length > 0 && status === 'MATCH') {
       status = 'DRIFT';
    }

    await supabase
      .from('channel_deployments')
      .update({ reconciliation_status: status })
      .eq('id', deployment.id);

    await logAudit(ownerId, 'GOOGLE_RECONCILIATION_COMPLETED', 'channel_deployment', deployment.id, null, { status, differences }, 'Reconciliation completed');
    
    return { status, differences };
  } catch (err: any) {
    throw new GoogleProviderError(ERROR_CODES.INTERNAL_ERROR, 'Failed to reconcile', { originalError: err.message });
  }
}
