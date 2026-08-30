import { createClient as createServerClient } from '../../supabase/server';
import { createServiceClient } from '../../supabase/service';
import { GoogleAdsApi } from 'google-ads-api';
import { decryptNamedSecret } from '../../crypto';
import { GoogleProviderError, ERROR_CODES } from './errors';
import { verifyTestAccount } from './test-account';
import { GoogleTargetState } from './types';
import { logAudit } from '../../audit';
import { gaqlStringLiteral } from './gaql';

export let __MockGoogleAdsApi: any = null;
export function __setMockGoogleAdsApi(mock: any) { __MockGoogleAdsApi = mock; }

export async function reconcileGoogleDeployment(campaignId: string, ownerId: string) {
  const serverClient = await createServerClient();
  const { data: authData, error: authError } = await serverClient.auth.getUser();
  if (authError || !authData?.user) throw new GoogleProviderError(ERROR_CODES.INTERNAL_ERROR, 'Failed to reconcile');
  if (authData.user.id !== ownerId) throw new GoogleProviderError(ERROR_CODES.INTERNAL_ERROR, 'Failed to reconcile');
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

  const refreshToken = decryptNamedSecret(creds.encrypted_credentials, 'refresh_token');

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
    const verifiedCustomerNum = verifiedCustomerId.replace(/-/g, '');

    // 1. BUDGET
    if (!externalState.campaignBudgetResourceName) {
      status = 'MISSING'; differences.push('Budget resource name missing in external state');
    } else {
      const bRes = await customer.query(`
        SELECT campaign_budget.amount_micros, customer.id
        FROM campaign_budget 
        WHERE campaign_budget.resource_name = ${gaqlStringLiteral(String(externalState.campaignBudgetResourceName))}
        LIMIT 1
      `);
      if (bRes.length === 0) {
        status = 'MISSING'; differences.push('Budget not found in Google Ads');
      } else {
        const b = bRes[0].campaign_budget;
        const custId = bRes[0].customer?.id?.toString();
        if (custId !== verifiedCustomerNum) { status = 'DRIFT'; differences.push('Budget does not belong to verified customer'); }
        if (b.amount_micros !== targetState.campaign.budget * 1000000) {
          status = 'DRIFT'; differences.push(`Budget amount mismatch`);
        }
      }
    }

    // 2. CAMPAIGN
    if (!externalState.campaignResourceName) {
      status = 'MISSING'; differences.push('Campaign resource name missing in external state');
    } else {
      const cRes = await customer.query(`
        SELECT campaign.bidding_strategy_type, campaign_budget.resource_name, customer.id
        FROM campaign 
        WHERE campaign.resource_name = ${gaqlStringLiteral(String(externalState.campaignResourceName))}
        LIMIT 1
      `);
      if (cRes.length === 0) {
        status = 'MISSING'; differences.push('Campaign not found in Google Ads');
      } else {
        const c = cRes[0].campaign;
        const cb = cRes[0].campaign_budget;
        const custId = cRes[0].customer?.id?.toString();
        if (custId !== verifiedCustomerNum) { status = 'DRIFT'; differences.push('Campaign does not belong to verified customer'); }
        if (cb.resource_name !== externalState.campaignBudgetResourceName) { status = 'DRIFT'; differences.push('Campaign does not use expected budget'); }
        const bstString = c.bidding_strategy_type === 3 ? 'MANUAL_CPC' : c.bidding_strategy_type === 10 ? 'MAXIMIZE_CONVERSIONS' : c.bidding_strategy_type;
        if (bstString !== targetState.bidding.strategy) { status = 'DRIFT'; differences.push('Bidding strategy mismatch'); }
      }
    }

    // 3. AD GROUP
    if (!externalState.adGroupResourceName) {
      status = 'MISSING'; differences.push('AdGroup resource name missing in external state');
    } else {
      const agRes = await customer.query(`
        SELECT ad_group.name, campaign.resource_name, customer.id
        FROM ad_group 
        WHERE ad_group.resource_name = ${gaqlStringLiteral(String(externalState.adGroupResourceName))}
        LIMIT 1
      `);
      if (agRes.length === 0) {
        status = 'MISSING'; differences.push('AdGroup not found in Google Ads');
      } else {
        const ag = agRes[0].ad_group;
        const c = agRes[0].campaign;
        const custId = agRes[0].customer?.id?.toString();
        if (custId !== verifiedCustomerNum) { status = 'DRIFT'; differences.push('AdGroup does not belong to verified customer'); }
        if (c.resource_name !== externalState.campaignResourceName) { status = 'DRIFT'; differences.push('AdGroup does not belong to expected campaign'); }
      }
    }

    // CREATIVE EXPECTATIONS
    const expectedHeadlines = (targetState.headlines || []).filter((h: any) => h.owner_approved && !h.rejected).map((h: any) => h.current_value.trim().toLowerCase()).sort();
    const expectedDescriptions = (targetState.descriptions || []).filter((d: any) => d.owner_approved && !d.rejected).map((d: any) => d.current_value.trim().toLowerCase()).sort();
    const expectedUrls = targetState.destination?.url ? [targetState.destination.url.trim().toLowerCase()] : [];
    const expectedKeywords = (targetState.keywords || []).filter((k: any) => k.owner_approved && !k.rejected).map((k: any) => ({
      text: k.current_value.trim().toLowerCase(),
      match_type: k.match_type || 'EXACT'
    })).sort((a: any, b: any) => a.text.localeCompare(b.text));

    // 4. ADS
    if (!externalState.adGroupResourceName) {
       // Cannot query ads if ad group is missing
    } else {
      const adRes = await customer.query(`
        SELECT ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.final_urls, customer.id, ad_group.resource_name
        FROM ad_group_ad 
        WHERE ad_group.resource_name = ${gaqlStringLiteral(String(externalState.adGroupResourceName))}
      `);
      
      const expectedAdCount = 1;
      if (adRes.length === 0) {
        status = 'MISSING'; differences.push('No ads found in AdGroup');
      } else if (adRes.length !== expectedAdCount) {
        status = 'DRIFT'; differences.push(`Ad count mismatch: Expected ${expectedAdCount}, found ${adRes.length}`);
      } else {
        const row = adRes[0];
        const ad = row.ad_group_ad?.ad;
        const custId = row.customer?.id?.toString();
        const parentAdGroup = row.ad_group?.resource_name;
        if (custId !== verifiedCustomerNum) { status = 'DRIFT'; differences.push('Ad does not belong to verified customer'); }
        if (parentAdGroup !== externalState.adGroupResourceName) { status = 'DRIFT'; differences.push('Ad does not belong to expected ad group'); }
        
        const rsa = ad?.responsive_search_ad || {};
        const actualHeadlines = (rsa.headlines || []).map((h: any) => h.text.trim().toLowerCase()).sort();
        const actualDescriptions = (rsa.descriptions || []).map((d: any) => d.text.trim().toLowerCase()).sort();
        const actualUrls = (ad?.final_urls || []).map((u: any) => u.trim().toLowerCase()).sort();

        if (JSON.stringify(actualHeadlines) !== JSON.stringify(expectedHeadlines)) {
          status = 'DRIFT'; differences.push('HEADLINE_MISMATCH');
        }
        if (JSON.stringify(actualDescriptions) !== JSON.stringify(expectedDescriptions)) {
          status = 'DRIFT'; differences.push('DESCRIPTION_MISMATCH');
        }
        if (JSON.stringify(actualUrls) !== JSON.stringify(expectedUrls)) {
          status = 'DRIFT'; differences.push('DESTINATION_URL_MISMATCH');
        }
      }
    }

    // 5. KEYWORDS
    if (externalState.adGroupResourceName) {
      const kwRes = await customer.query(`
        SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, customer.id, ad_group.resource_name, customer.id
        FROM ad_group_criterion 
        WHERE ad_group.resource_name = ${gaqlStringLiteral(String(externalState.adGroupResourceName))} AND ad_group_criterion.type = 'KEYWORD'
      `);
      
      const actualKeywords = kwRes.map((r: any) => ({
        text: r.ad_group_criterion.keyword.text.trim().toLowerCase(),
        match_type: r.ad_group_criterion.keyword.match_type === 2 ? 'EXACT' : r.ad_group_criterion.keyword.match_type === 3 ? 'PHRASE' : r.ad_group_criterion.keyword.match_type === 4 ? 'BROAD' : r.ad_group_criterion.keyword.match_type
      })).sort((a: any, b: any) => a.text.localeCompare(b.text));

      for (const r of kwRes) {
        const custId = r.customer?.id?.toString();
        const parentAdGroup = r.ad_group?.resource_name;
        if (custId !== verifiedCustomerNum) {
          status = 'DRIFT'; differences.push('Keyword does not belong to verified customer');
        }
        if (parentAdGroup !== externalState.adGroupResourceName) {
          status = 'DRIFT'; differences.push('Keyword does not belong to expected ad group');
        }
      }

      if (JSON.stringify(actualKeywords) !== JSON.stringify(expectedKeywords)) {
        status = 'DRIFT'; differences.push('KEYWORD_MISMATCH');
      }
    }

    await logAudit(ownerId, 'GOOGLE_RECONCILIATION_COMPLETED', 'channel_deployment', deployment.id, null, { status, differences }, 'Reconciliation completed');
    
    return { status, differences };
  } catch (err: any) {
    if (err instanceof GoogleProviderError) {
      throw err;
    }
    throw new GoogleProviderError(ERROR_CODES.INTERNAL_ERROR, 'Failed to reconcile');
  }
}
