import { authorizeGoogleTestMutation } from './mutation-gate';
import { createServiceClient } from '../../supabase/service';
import { createClient as createServerClient } from '../../supabase/server';
import { decryptCredential } from '../../crypto';
import { GoogleAdsMutationClient } from './client';
import { GoogleProviderError, ERROR_CODES } from './errors';
import { logAudit } from '../../audit';
import { GoogleTargetState, GoogleCreativeItem } from './types';
import { reconcileGoogleDeployment } from './reconciliation';
import { calculateSafetyLimits } from '../../campaigns/safeguards';
import { verifyTestAccount } from './test-account';

export async function deployGoogleCampaign(campaignId: string, ownerId: string): Promise<void> {
  const serverClient = await createServerClient();
  const { data: authData, error: authError } = await serverClient.auth.getUser();
  if (authError || !authData?.user) {
    throw new GoogleProviderError(ERROR_CODES.AUTH_FAILED, 'Authentication required to deploy campaign.');
  }

  const authenticatedUid = authData.user.id;
  if (authenticatedUid !== ownerId) {
    throw new GoogleProviderError(ERROR_CODES.AUTH_FAILED, 'Unauthorized: You cannot deploy a campaign you do not own.');
  }

  const supabase = await createServiceClient();

  // 1. Fetch deployment record and lock ATOMICALLY
  const { data: deployment, error: depError } = await supabase
    .from('channel_deployments')
    .update({
      status: 'DEPLOYMENT_LOCKED',
      locked_at: new Date().toISOString(),
      locked_by: authenticatedUid,
    })
    .eq('campaign_id', campaignId)
    .eq('provider', 'google')
    .eq('owner_id', authenticatedUid)
    .eq('status', 'READY_TO_DEPLOY')
    .select('*')
    .single();

  if (depError || !deployment) {
    throw new GoogleProviderError(ERROR_CODES.RESOURCE_CONFLICT, 'Deployment not found or already locked / in progress.');
  }

  try {
    // 2. Fetch campaign
    const { data: campaign, error: campError } = await supabase
      .from('unified_campaigns')
      .select('*')
      .eq('id', campaignId)
      .eq('owner_id', authenticatedUid)
      .single();

    if (campError || !campaign) throw new Error('Campaign not found');

    const targetState = deployment.target_state as GoogleTargetState;

    // 3. Fetch credentials
    const { data: creds, error: credError } = await supabase
      .from('integration_credentials')
      .select('encrypted_credentials')
      .eq('owner_id', authenticatedUid)
      .eq('provider', 'google')
      .single();

    if (credError || !creds) throw new GoogleProviderError(ERROR_CODES.AUTH_FAILED, 'Google integration credentials missing');

    const decrypted = JSON.parse(creds.encrypted_credentials);
    const refreshToken = decryptCredential(decrypted.refresh_token);

    
    
    const budgetAmount = Number(campaign.budget_amount);
    const durationDays = Number(campaign.duration_days);

    if (durationDays <= 0 || isNaN(durationDays)) {
      throw new Error('Invalid duration');
    }

    const rawBudgetType = campaign.budget_type?.toLowerCase();
    if (rawBudgetType !== 'daily' && rawBudgetType !== 'lifetime') {
      throw new GoogleProviderError('INVALID_BUDGET_TYPE', 'Budget type must be exactly daily or lifetime.');
    }
    const budgetTypeStr = rawBudgetType as 'daily' | 'lifetime';
    if (Number(campaign.max_auto_budget_increase) !== 0) {
      throw new GoogleProviderError('SAFETY_VIOLATION', 'max_auto_budget_increase must be exactly 0.');
    }
    const limits = calculateSafetyLimits(budgetTypeStr, budgetAmount, durationDays);

    // 4. Authorize Mutation Gate

    const verifiedCustomerId = await authorizeGoogleTestMutation(
      authenticatedUid,
      'READY_TO_DEPLOY',
      deployment,
      targetState,
      refreshToken
    );



    if (
      targetState.campaign.budget !== budgetAmount ||
      Number(campaign.max_daily_spend) !== limits.maxDaily ||
      Number(campaign.max_campaign_spend) !== limits.maxTotal
    ) {
      throw new Error('Budget mismatch: Target state or campaign budget properties do not match authoritative calculation.');
    }
    
    // Validate creatives
    const allCreatives = [...targetState.headlines, ...targetState.descriptions, ...targetState.keywords];
    for (const item of allCreatives) {
      if (item.rejected || item.owner_approved !== true) {
        throw new Error('Unapproved or rejected creative found in target state.');
      }
    }

    
    const client = new GoogleAdsMutationClient({
      developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
      refreshToken: refreshToken,
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      customerId: verifiedCustomerId,
      managerId: process.env.GOOGLE_ADS_TEST_MANAGER_ID!,
    });

    await client.initialize();

    await logAudit(authenticatedUid, 'GOOGLE_TEST_ACCOUNT_VERIFIED', 'channel_deployment', deployment.id, null, null, 'Test account boundary verified');
    await logAudit(authenticatedUid, 'GOOGLE_DEPLOYMENT_STARTED', 'channel_deployment', deployment.id, null, null, 'Beginning sequential deployment');

    let externalState = deployment.external_state || {};
    const updateExternalState = async (updates: any, newStatus: string) => {
      externalState = { ...externalState, ...updates };
      await supabase
        .from('channel_deployments')
        .update({ external_state: externalState, status: newStatus })
        .eq('id', deployment.id);
    };

    // 4. Create Budget
    if (!externalState.campaignBudgetResourceName) {
      await updateExternalState({}, 'CREATING_CAMPAIGN');
      const budgetName = `MKTOS-E2E-${deployment.id}-BUDGET`;
      let budgetResource = await client.findBudgetByName(budgetName);
      if (!budgetResource) {
        const budgetAmountMicros = targetState.campaign.budget * 1000000;
        budgetResource = await client.createCampaignBudget(budgetName, budgetAmountMicros);
      }
      await updateExternalState({ campaignBudgetResourceName: budgetResource }, 'CREATING_CAMPAIGN');
    }

    // 5. Create Campaign
    if (!externalState.campaignResourceName) {
      const campName = `MKTOS-E2E-${deployment.id}-CAMPAIGN`;
      let campaignResource = await client.findCampaignByName(campName);
      if (!campaignResource) {
        campaignResource = await client.createCampaign(
          campName,
          externalState.campaignBudgetResourceName,
          targetState.bidding.strategy
        );
      }
      await updateExternalState({ campaignResourceName: campaignResource }, 'CREATING_AD_GROUP');
      await logAudit(authenticatedUid, 'GOOGLE_CAMPAIGN_CREATED', 'channel_deployment', deployment.id, null, { resourceName: campaignResource }, 'Campaign created');
    }

    // 6. Create Ad Group
    if (!externalState.adGroupResourceName) {
      await updateExternalState({}, 'CREATING_AD_GROUP');
      const adGroupName = `MKTOS-E2E-${deployment.id}-ADGROUP`;
      let adGroupResource = await client.findAdGroupByName(externalState.campaignResourceName, adGroupName);
      if (!adGroupResource) {
        adGroupResource = await client.createAdGroup(adGroupName, externalState.campaignResourceName);
      }
      await updateExternalState({ adGroupResourceName: adGroupResource }, 'CREATING_ADS');
      await logAudit(authenticatedUid, 'GOOGLE_AD_GROUP_CREATED', 'channel_deployment', deployment.id, null, { resourceName: adGroupResource }, 'Ad Group created');
    }

    // 7. Create Ads
    if (!externalState.adResourceNames || externalState.adResourceNames.length === 0) {
      await updateExternalState({}, 'CREATING_ADS');
      let adResourceNames = await client.findAdGroupAds(externalState.adGroupResourceName);
      if (adResourceNames.length === 0) {
        const headlines = targetState.headlines.map((h: GoogleCreativeItem) => h.current_value);
        const descriptions = targetState.descriptions.map((d: GoogleCreativeItem) => d.current_value);
        
        const adResource = await client.createResponsiveSearchAd(
          externalState.adGroupResourceName,
          headlines,
          descriptions,
          targetState.destination.url
        );
        adResourceNames = [adResource];
      }
      await updateExternalState({ adResourceNames }, 'CREATING_KEYWORDS');
      await logAudit(authenticatedUid, 'GOOGLE_AD_CREATED', 'channel_deployment', deployment.id, null, { resourceNames: adResourceNames }, 'Ads created');
    }

    // 8. Create Keywords
    if (!externalState.keywordResourceNames || externalState.keywordResourceNames.length < targetState.keywords.length) {
      await updateExternalState({}, 'CREATING_KEYWORDS');
      const existingKeywords = await client.findKeywords(externalState.adGroupResourceName);
      const keywordResourceNames = existingKeywords.map(k => k.resource_name);
      
      const existingTexts = new Set(existingKeywords.map(k => `${k.text.toLowerCase()}|${k.match_type}`));
      for (const kw of targetState.keywords) {
        if (!existingTexts.has(`${kw.current_value.toLowerCase()}|${kw.match_type || 'EXACT'}`)) {
          const kwResource = await client.createKeyword(externalState.adGroupResourceName, kw.current_value, kw.match_type || 'EXACT');
          keywordResourceNames.push(kwResource);
        }
      }
      await updateExternalState({ keywordResourceNames }, 'VERIFYING');
      await logAudit(authenticatedUid, 'GOOGLE_KEYWORD_CREATED', 'channel_deployment', deployment.id, null, { resourceNames: keywordResourceNames }, 'Keywords created');
    }

    // 9. RECONCILIATION GATE
    const reconciliationResult = await reconcileGoogleDeployment(campaignId, authenticatedUid);
    
    if (reconciliationResult.status === 'MATCH') {
      await supabase
        .from('channel_deployments')
        .update({ status: 'ACTIVE', reconciliation_status: 'MATCH' })
        .eq('id', deployment.id);
      await logAudit(authenticatedUid, 'GOOGLE_DEPLOYMENT_VERIFIED', 'channel_deployment', deployment.id, null, null, 'Deployment successfully verified and activated');
    } else {
      await supabase
        .from('channel_deployments')
        .update({ status: 'FAILED', reconciliation_status: reconciliationResult.status })
        .eq('id', deployment.id);

      throw new Error(`Deployment reconciliation failed with result: ${reconciliationResult.status}`);
    }

  } catch (err: any) {
    // Handle partial failure
    await supabase
      .from('channel_deployments')
      .update({
        status: 'FAILED',
        failure_code: err.code || ERROR_CODES.INTERNAL_ERROR,
        failure_stage: 'DEPLOYMENT',
        reconciliation_status: 'REQUIRED'
      })
      .eq('id', deployment.id);
      
    await logAudit(authenticatedUid, 'GOOGLE_DEPLOYMENT_FAILED', 'channel_deployment', deployment.id, null, { error_code: err.code || ERROR_CODES.INTERNAL_ERROR, stage: 'DEPLOYMENT' }, 'Deployment failed');
    throw err;
  }
}
