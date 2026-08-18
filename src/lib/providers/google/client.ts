import { GoogleAdsApi, Customer } from 'google-ads-api';
import { verifyTestAccount } from './test-account';
import { GoogleProviderError, ERROR_CODES } from './errors';

export interface GoogleAdsCredentials {
  developerToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  customerId: string;
  managerId: string;
}

export let __MockGoogleAdsApi: any = null;
export function __setMockGoogleAdsApi(mock: any) { __MockGoogleAdsApi = mock; }

export class GoogleAdsMutationClient {
  private customer!: Customer;

  constructor(private creds: GoogleAdsCredentials) {}

  async initialize() {
    const verifiedCustomerId = await verifyTestAccount(
      this.creds.developerToken,
      this.creds.refreshToken,
      this.creds.clientId,
      this.creds.clientSecret,
      this.creds.customerId,
      this.creds.managerId
    );

    const ApiClass = __MockGoogleAdsApi || GoogleAdsApi;
    const client = new ApiClass({
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret,
      developer_token: this.creds.developerToken,
    });

    this.customer = client.Customer({
      customer_id: verifiedCustomerId,
      refresh_token: this.creds.refreshToken,
      login_customer_id: this.creds.managerId,
    });
  }

  async createCampaignBudget(name: string, amountMicros: number): Promise<string> {
    try {
      const response: any = await this.customer.mutateResources([
        {
          entity: 'campaign_budget',
          operation: 'create',
          resource: {
            name,
            amount_micros: amountMicros,
            delivery_method: 'STANDARD',
            explicitly_shared: false,
          },
        },
      ]);
      return response[0].mutated_resource_name;
    } catch (err: any) {
      throw this.mapError(err, 'createCampaignBudget');
    }
  }

  async createCampaign(name: string, budgetResourceName: string, biddingStrategy: string): Promise<string> {
    try {
      const resource: any = {
        name,
        status: 'PAUSED',
        advertising_channel_type: 'SEARCH',
        campaign_budget: budgetResourceName,
        network_settings: {
          target_google_search: true,
          target_search_network: false,
          target_content_network: false,
          target_partner_search_network: false,
        },
      };

      if (biddingStrategy === 'MANUAL_CPC') {
        resource.manual_cpc = { enhanced_cpc_enabled: false };
      } else if (biddingStrategy === 'MAXIMIZE_CLICKS') {
        resource.maximize_clicks = {};
      } else if (biddingStrategy === 'MAXIMIZE_CONVERSIONS') {
        resource.maximize_conversions = {};
      }

      const response: any = await this.customer.mutateResources([
        {
          entity: 'campaign',
          operation: 'create',
          resource,
        },
      ]);
      return response[0].mutated_resource_name;
    } catch (err: any) {
      throw this.mapError(err, 'createCampaign');
    }
  }

  async createAdGroup(name: string, campaignResourceName: string): Promise<string> {
    try {
      const response: any = await this.customer.mutateResources([
        {
          entity: 'ad_group',
          operation: 'create',
          resource: {
            name,
            campaign: campaignResourceName,
            type: 'SEARCH_STANDARD',
            status: 'ENABLED',
            cpc_bid_micros: 1000000, // 1 unit default for manual CPC
          },
        },
      ]);
      return response[0].mutated_resource_name;
    } catch (err: any) {
      throw this.mapError(err, 'createAdGroup');
    }
  }

  async createResponsiveSearchAd(
    adGroupResourceName: string,
    headlines: string[],
    descriptions: string[],
    finalUrl: string
  ): Promise<string> {
    try {
      const response: any = await this.customer.mutateResources([
        {
          entity: 'ad_group_ad',
          operation: 'create',
          resource: {
            ad_group: adGroupResourceName,
            status: 'ENABLED',
            ad: {
              final_urls: [finalUrl],
              responsive_search_ad: {
                headlines: headlines.map(text => ({ text })),
                descriptions: descriptions.map(text => ({ text })),
              },
            },
          },
        },
      ]);
      return response[0].mutated_resource_name;
    } catch (err: any) {
      throw this.mapError(err, 'createResponsiveSearchAd');
    }
  }

  async createKeyword(adGroupResourceName: string, text: string, matchType: string): Promise<string> {
    try {
      const response: any = await this.customer.mutateResources([
        {
          entity: 'ad_group_criterion',
          operation: 'create',
          resource: {
            ad_group: adGroupResourceName,
            status: 'ENABLED',
            keyword: {
              text,
              match_type: matchType,
            },
          },
        },
      ]);
      return response[0].mutated_resource_name;
    } catch (err: any) {
      throw this.mapError(err, 'createKeyword');
    }
  }

  async findBudgetByName(name: string): Promise<string | null> {
    try {
      const response = await this.customer.query(`
        SELECT campaign_budget.resource_name 
        FROM campaign_budget 
        WHERE campaign_budget.name = '${name}' 
        LIMIT 1
      `);
      return response.length > 0 && response[0].campaign_budget ? (response[0].campaign_budget.resource_name || null) : null;
    } catch (err: any) {
      throw this.mapError(err, 'findBudgetByName');
    }
  }

  async findCampaignByName(name: string): Promise<string | null> {
    try {
      const response = await this.customer.query(`
        SELECT campaign.resource_name 
        FROM campaign 
        WHERE campaign.name = '${name}' 
        LIMIT 1
      `);
      return response.length > 0 && response[0].campaign ? (response[0].campaign.resource_name || null) : null;
    } catch (err: any) {
      throw this.mapError(err, 'findCampaignByName');
    }
  }

  async findAdGroupByName(campaignResourceName: string, name: string): Promise<string | null> {
    try {
      const response = await this.customer.query(`
        SELECT ad_group.resource_name 
        FROM ad_group 
        WHERE ad_group.name = '${name}' AND campaign.resource_name = '${campaignResourceName}'
        LIMIT 1
      `);
      return response.length > 0 && response[0].ad_group ? (response[0].ad_group.resource_name || null) : null;
    } catch (err: any) {
      throw this.mapError(err, 'findAdGroupByName');
    }
  }

  async findAdGroupAds(adGroupResourceName: string): Promise<string[]> {
    try {
      const response = await this.customer.query(`
        SELECT ad_group_ad.ad.resource_name 
        FROM ad_group_ad 
        WHERE ad_group.resource_name = '${adGroupResourceName}'
      `);
      return response.map((r: any) => r.ad_group_ad.ad.resource_name);
    } catch (err: any) {
      throw this.mapError(err, 'findAdGroupAds');
    }
  }

  async findKeywords(adGroupResourceName: string): Promise<string[]> {
    try {
      const response = await this.customer.query(`
        SELECT ad_group_criterion.criterion_id, ad_group_criterion.resource_name 
        FROM ad_group_criterion 
        WHERE ad_group.resource_name = '${adGroupResourceName}' AND ad_group_criterion.type = 'KEYWORD'
      `);
      return response.map((r: any) => r.ad_group_criterion.resource_name);
    } catch (err: any) {
      throw this.mapError(err, 'findKeywords');
    }
  }

  private mapError(err: any, context: string): GoogleProviderError {
    // DO NOT LOG RAW GOOGLE ERRORS containing credentials/tokens.
    const message = err?.message || 'Unknown error';
    if (message.includes('AUTHENTICATION_ERROR')) {
      return new GoogleProviderError(ERROR_CODES.AUTH_FAILED, 'Authentication to Google Ads failed.');
    }
    if (message.includes('QUOTA_CHECK_FAILED') || message.includes('RATE_EXCEEDED')) {
      return new GoogleProviderError(ERROR_CODES.RATE_LIMITED, 'Google Ads API rate limit exceeded.');
    }
    
    // Sanitize string before returning to prevent leaking details
    const sanitizedMsg = message.replace(/bearer\s+[A-Za-z0-9-_=]+/ig, 'Bearer [REDACTED]')
                                .replace(/developer-token: \S+/ig, 'developer-token: [REDACTED]');
                                
    return new GoogleProviderError(
      ERROR_CODES.INVALID_REQUEST,
      `Google Ads API request failed in ${context}`,
      [{ message: sanitizedMsg }]
    );
  }
}
