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

  const verifiedCustomerId = await verifyTestAccount(
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
    customer_id: verifiedCustomerId,
    refresh_token: refreshToken,
    login_customer_id: process.env.GOOGLE_ADS_TEST_MANAGER_ID!,
  });

  const externalState = deployment.external_state || {};
  const targetState = deployment.target_state as GoogleTargetState;
  const differences: string[] = [];
  let status = 'MATCH';

  try {
    // CAMPAIGN & BUDGET
    if (!externalState.campaignResourceName) {
      status = 'MISSING';
      differences.push('Campaign resource name missing in external state');
    } else {
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
        if (budget.amount_micros !== targetState.campaign.budget * 1000000) {
          status = 'DRIFT';
          differences.push(`Budget mismatch. Expected ${targetState.campaign.budget * 1000000}, found ${budget.amount_micros}`);
        }
        if (camp.bidding_strategy_type !== targetState.bidding.strategy) {
          status = 'DRIFT';
          differences.push(`Bidding strategy mismatch. Expected ${targetState.bidding.strategy}, found ${camp.bidding_strategy_type}`);
        }
      }
    }

    // AD GROUP
    if (!externalState.adGroupResourceName) {
      status = 'MISSING';
      differences.push('AdGroup resource name missing in external state');
    } else {
      const agResponse = await customer.query(`
        SELECT ad_group.name, ad_group.type, campaign.resource_name 
        FROM ad_group 
        WHERE ad_group.resource_name = '${externalState.adGroupResourceName}'
        LIMIT 1
      `);
      if (agResponse.length === 0) {
        status = 'MISSING';
        differences.push('AdGroup not found in Google Ads');
      } else {
        const ag = agResponse[0].ad_group;
        const c = agResponse[0].campaign;
        if (ag.name !== targetState.adGroup.name) {
           status = 'DRIFT'; differences.push('AdGroup name mismatch');
        }
        if (c.resource_name !== externalState.campaignResourceName) {
           status = 'DRIFT'; differences.push('AdGroup does not belong to expected campaign');
        }
      }
    }

    // ADS
    if (!externalState.adResourceNames || externalState.adResourceNames.length === 0) {
      status = 'MISSING';
      differences.push('Ads missing in external state');
    } else {
      for (const adRes of externalState.adResourceNames) {
        const adResponse = await customer.query(`
          SELECT ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.final_urls
          FROM ad_group_ad 
          WHERE ad_group_ad.ad.resource_name = '${adRes}'
          LIMIT 1
        `);
        if (adResponse.length === 0) {
          status = 'MISSING';
          differences.push(`Ad ${adRes} not found`);
        } else {
          // Check components
          const rsa = adResponse[0].ad_group_ad?.ad?.responsive_search_ad || {};
          const urls = adResponse[0].ad_group_ad?.ad?.final_urls || [];
          console.log('RECONCILIATION AD VALUES:', { urls, targetUrl: targetState.destination.url, rsaHeadlines: rsa.headlines, targetHeadlines: targetState.headlines });
          if (!urls.includes(targetState.destination.url)) {
            status = 'DRIFT'; differences.push('Ad destination URL mismatch');
          }
          if (!rsa.headlines || rsa.headlines.length !== targetState.headlines.length) {
             status = 'DRIFT'; differences.push('Ad headlines count mismatch');
          }
        }
      }
    }

    // KEYWORDS
    if (targetState.keywords && targetState.keywords.length > 0) {
      if (!externalState.keywordResourceNames || externalState.keywordResourceNames.length === 0) {
        status = 'MISSING';
        differences.push('Keywords missing in external state');
      } else {
        for (const kwRes of externalState.keywordResourceNames) {
        const kwResponse = await customer.query(`
          SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
          FROM ad_group_criterion 
          WHERE ad_group_criterion.resource_name = '${kwRes}'
          LIMIT 1
        `);
        if (kwResponse.length === 0) {
          status = 'MISSING';
          differences.push(`Keyword ${kwRes} not found`);
        } else {
          const text = kwResponse[0].ad_group_criterion?.keyword?.text;
          const matchType = kwResponse[0].ad_group_criterion?.keyword?.match_type;
          // check if text is in targetState
          if (!targetState.keywords.find(k => k.current_value === text && (k.match_type || 'EXACT') === matchType)) {
             status = 'DRIFT'; differences.push(`Keyword ${text} mismatch or not found in target state`);
          }
          }
        }
      }
    }

    await logAudit(ownerId, 'GOOGLE_RECONCILIATION_COMPLETED', 'channel_deployment', deployment.id, null, { status, differences }, 'Reconciliation completed');
    
    return { status, differences };
  } catch (err: any) {
    const sanitizedMsg = (err.message || '').replace(/bearer\s+[A-Za-z0-9-_=]+/ig, 'Bearer [REDACTED]');
    throw new GoogleProviderError(ERROR_CODES.INTERNAL_ERROR, 'Failed to reconcile', { originalError: sanitizedMsg });
  }
}
