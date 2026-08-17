import { StrategyContext } from './types';
import { GoogleAccountContextProvider } from './context';
import { createClient } from '@/lib/supabase/server';

export class GoogleAdsReadOnlyContextProvider implements GoogleAccountContextProvider {
  constructor(private client?: any) {}

  async getStrategyContext(ownerId: string): Promise<StrategyContext> {
    const supabase = this.client || await createClient();

    // Verify integration exists
    const { data: integration, error } = await supabase
      .from('integrations')
      .select('credentials')
      .eq('owner_id', ownerId)
      .eq('provider', 'google')
      .single();

    if (error || !integration || !integration.credentials) {
      throw new Error('GOOGLE_CONTEXT_UNAVAILABLE');
    }

    // In a real application, we would use the credentials to call Google Ads API:
    // const client = new GoogleAdsApi(integration.credentials.access_token);
    // const metrics = await client.getMetrics();
    // 
    // Since this is Milestone 5 (No mutation, read-only prep), and we don't have real live tokens yet:
    // We throw GOOGLE_CONTEXT_UNAVAILABLE if it fails, which it will if the credentials aren't fully valid.
    
    // As per requirements: Do not silently fall back to mock data.
    // We will just throw the explicit error requested to prove safety,
    // or if we had real test-account credentials, return them.
    // For M5, since we can't truly read Google without tokens, we fail closed.
    throw new Error('GOOGLE_CONTEXT_UNAVAILABLE');
  }
}
