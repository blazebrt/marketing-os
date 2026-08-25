import { GoogleAdsApi } from 'google-ads-api';
import { GoogleProviderError, ERROR_CODES } from './errors';

export let __MockGoogleAdsApi: any = null;
export function __setMockGoogleAdsApi(mock: any) { __MockGoogleAdsApi = mock; }

export async function verifyTestAccount(
  developerToken: string,
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  customerId: string,
  managerId: string
): Promise<string> {
  if (process.env.GOOGLE_ADS_EXECUTION_MODE !== 'test') {
    throw new GoogleProviderError(
      ERROR_CODES.TEST_ACCOUNT_REQUIRED,
      'Execution mode is not explicitly configured for test mode.'
    );
  }

  if (!developerToken || !customerId || !managerId) {
    throw new GoogleProviderError(
      ERROR_CODES.TEST_ACCOUNT_REQUIRED,
      'Missing required test account configuration variables.'
    );
  }

  try {
    const cleanCustomerId = customerId.replace(/-/g, '');
    const cleanManagerId = managerId.replace(/-/g, '');

    const ApiClass = __MockGoogleAdsApi || GoogleAdsApi;
    const client = new ApiClass({
      client_id: clientId,
      client_secret: clientSecret,
      developer_token: developerToken,
    });

    const customer = client.Customer({
      customer_id: cleanCustomerId,
      refresh_token: refreshToken,
      login_customer_id: cleanManagerId,
    });

    const response = await customer.query(
      `SELECT customer.id, customer.test_account, customer.descriptive_name 
       FROM customer 
       WHERE customer.id = ${cleanCustomerId} 
       LIMIT 1`
    );

    const customerData = response[0]?.customer;
    if (!customerData) {
      throw new Error('Customer not found');
    }

    if (customerData.test_account !== true) {
      throw new GoogleProviderError(
        ERROR_CODES.TEST_ACCOUNT_REQUIRED,
        'Configured customer is NOT a test account.'
      );
    }
    
    return customerData.id.toString();
  } catch (err: any) {
    if (err instanceof GoogleProviderError) {
      throw err;
    }
    throw new GoogleProviderError(
      ERROR_CODES.TEST_ACCOUNT_REQUIRED,
      'Failed to verify test account status.'
    );
  }
}
