import { StrategyContext } from './types';
import { GoogleAccountContextProvider } from './context';
import { createServiceClient } from '@/lib/supabase/service';
import { decryptNamedSecret } from '@/lib/crypto';

/**
 * Production Google Ads read-only context provider.
 *
 * Security boundary:
 *   authenticated server request
 *     → verify owner_id
 *     → server-only service client
 *     → integration_credentials (zero browser RLS)
 *     → decrypt encrypted_credentials
 *     → Google Ads READ-ONLY request
 *     → StrategyContext
 *
 * Decrypted credentials NEVER enter:
 *   target_state, audit_logs, browser responses,
 *   React props, client components, logs, or API routes.
 *
 * Zero mutation endpoints. No POST/CREATE/UPDATE/MUTATE operations.
 */
export class GoogleAdsReadOnlyContextProvider implements GoogleAccountContextProvider {
  // serviceClientOverride is strictly for testing injection.
  // Production code MUST call this constructor with zero arguments.
  constructor(private serviceClientOverride?: any) {}

  async getStrategyContext(ownerId: string): Promise<StrategyContext> {
    // 1. Obtain server-only service client (bypasses RLS)
    let serviceClient: any;
    try {
      serviceClient = this.serviceClientOverride || createServiceClient();
    } catch {
      throw new Error('GOOGLE_CONTEXT_UNAVAILABLE');
    }

    // 2. Query integration_credentials — NOT integrations.credentials
    //    integration_credentials has zero authenticated/anon RLS policies.
    //    Only service_role can read this table.
    const { data: credRow, error } = await serviceClient
      .from('integration_credentials')
      .select('encrypted_credentials')
      .eq('owner_id', ownerId)
      .eq('provider', 'google')
      .single();

    if (error || !credRow || !credRow.encrypted_credentials) {
      throw new Error('GOOGLE_CONTEXT_UNAVAILABLE');
    }

    // 3. Decrypt credentials server-side
    let accessToken: string;
    try {
      accessToken = decryptNamedSecret(credRow.encrypted_credentials, 'access_token');
    } catch {
      // Covers: invalid JSON, missing fields, wrong ENCRYPTION_KEY, corrupt data
      throw new Error('GOOGLE_CONTEXT_UNAVAILABLE');
    }

    // 4. Fetch read-only Google Ads metrics
    //    NO mutation endpoints. Zero POST/CREATE/UPDATE/MUTATE.
    return await this.fetchReadOnlyMetrics(accessToken);
  }

  /**
   * Read-only Google Ads API metrics fetch.
   *
   * When implemented, will query ONLY:
   *   - customer account metadata (account age)
   *   - conversion metrics (LAST_30_DAYS)
   *   - conversion tracking status
   *
   * Will NOT call:
   *   - CampaignService.MutateCampaigns
   *   - AdGroupService.MutateAdGroups
   *   - AdService.MutateAds
   *   - KeywordPlanService
   *   - BudgetService
   *   - ConversionActionService.MutateConversionActions
   *   - Any other mutating endpoint
   *
   * In M5: no live Google Ads API integration exists.
   * Fails closed. Does NOT substitute hardcoded values.
   * Does NOT call MockGoogleAccountContextProvider.
   */
  private async fetchReadOnlyMetrics(_accessToken: string): Promise<StrategyContext> {
    // M5: fail closed — real Google Ads API integration deferred to future milestone.
    // Do NOT substitute conversionCount = 0 or accountAgeDays = 5.
    throw new Error('GOOGLE_CONTEXT_UNAVAILABLE');
  }
}
