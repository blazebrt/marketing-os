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
    await verifyTestAccount(
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
      customer_id: this.creds.customerId,
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

  private mapError(err: any, context: string): GoogleProviderError {
    console.error(`Google API Error [${context}]:`, err);
    if (err.message?.includes('AUTHENTICATION_ERROR')) {
      return new GoogleProviderError(ERROR_CODES.AUTH_FAILED, 'Authentication to Google Ads failed.');
    }
    if (err.message?.includes('QUOTA_CHECK_FAILED') || err.message?.includes('RATE_EXCEEDED')) {
      return new GoogleProviderError(ERROR_CODES.RATE_LIMITED, 'Google Ads API rate limit exceeded.');
    }
    return new GoogleProviderError(
      ERROR_CODES.INVALID_REQUEST,
      `Google Ads API request failed: ${err.message}`,
      err.errors || []
    );
  }
}
