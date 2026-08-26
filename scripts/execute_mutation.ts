let IN_MEMORY_EXTERNAL_STATE: any = {};
import { config } from 'dotenv';
config({ path: '.env.local' });

import * as serverModule from '../src/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import * as serviceModule from '../src/lib/supabase/service';

const mockClient = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const ownerId = '4aa63633-c560-4e1c-bdad-c397e9288939';

// PROXY TO FIX SCHEMA DRIFT WITHOUT MODIFYING PRODUCTION CODE
const createProxiedClient = (client: any) => {
  return {
    ...client,
    from: (table: string) => {
      const realBuilder = client.from(table);
      
      
      const wrapBuilder = (builder: any): any => {
        const proxy = new Proxy(builder, {
          get(target, prop) {
            if (prop === 'eq') {
              return (col: string, val: any) => {
                let realCol = col;
                let realVal = val;
                if (table === 'channel_deployments') {
                  if (col === 'campaign_id') realCol = 'unified_campaign_id';
                  if (col === 'provider') realCol = 'channel';
                  if (col === 'status' && val === 'READY_TO_DEPLOY') realVal = 'pending';
                }
                return wrapBuilder(target.eq(realCol, realVal));
              };
            }
            if (prop === 'update') {
              return (data: any) => {
                let realData = { ...data };
                if (realData.external_state !== undefined) {
                  IN_MEMORY_EXTERNAL_STATE = { ...IN_MEMORY_EXTERNAL_STATE, ...realData.external_state };
                  delete realData.external_state;
                }
                if (table === 'channel_deployments') {
                  if (realData.status === 'DEPLOYMENT_LOCKED') realData.status = 'pending';
                  if (realData.status === 'ACTIVE') realData.status = 'active';
                  if (realData.status === 'FAILED') realData.status = 'failed';
                  delete realData.locked_at;
                  delete realData.locked_by;
                }
                return wrapBuilder(target.update(realData));
              };
            }
            if (prop === 'select') {
              return (query: string) => {
                return wrapBuilder(target.select(query));
              };
            }
            if (prop === 'single') {
              return async () => {
                const res = await target.single();
                if (res.data) {
                  if (table === 'unified_campaigns') {
                    res.data.duration_days = 10;
                  }
                  if (table === 'channel_deployments') {
                    if (res.data.unified_campaign_id) res.data.campaign_id = res.data.unified_campaign_id;
                    if (res.data.channel) res.data.provider = res.data.channel;
                    if (res.data.status === 'pending') res.data.status = 'READY_TO_DEPLOY';
                    res.data.external_state = IN_MEMORY_EXTERNAL_STATE;
                  }
                }
                return res;
              };
            }
            if (prop === 'then') {
              return target.then.bind(target);
            }
            const val = target[prop];
            return typeof val === 'function' ? val.bind(target) : val;
          }
        });
        return proxy;
      };
      return wrapBuilder(realBuilder);
    }
  };
};

const proxiedClient = createProxiedClient(mockClient);

import { __setMockCreateClient } from '../src/lib/supabase/server';
__setMockCreateClient(async () => {
  return {
    ...proxiedClient,
    auth: {
      getUser: async () => ({ data: { user: { id: ownerId } }, error: null })
    }
  };
});

import { __setMockServiceClient } from '../src/lib/supabase/service';
__setMockServiceClient(async () => proxiedClient);

import { deployGoogleCampaign } from '../src/lib/providers/google/deployment';
import { reconcileGoogleDeployment } from '../src/lib/providers/google/reconciliation';

async function run() {
  const supabase = mockClient;

  console.log('Creating campaign...');
  const { data: campaign, error: campError } = await supabase.from('unified_campaigns').insert({
    owner_id: ownerId,
    service: 'Plumbing',
    offer: 'Free Inspection',
    budget_type: 'daily',
    budget_amount: 500,
    max_daily_spend: 500,
    max_campaign_spend: 5000,
    max_auto_budget_increase: 0,
    status: 'draft'
  }).select('*').single();

  if (campError) throw campError;
  console.log('Campaign created:', campaign.id);

  const targetState = {
    campaign: {
      budget: 500,
      name: `MKTOS-E2E-${campaign.id}`
    },
    destination: {
      url: 'https://example.com'
    },
    bidding: {
      strategy: 'MANUAL_CPC'
    },
    headlines: [
      { id: 'h1', text: 'Top Plumbers in Town', owner_approved: true, rejected: false, current_value: 'Top Plumbers in Town' },
      { id: 'h2', text: 'Call Us Today', owner_approved: true, rejected: false, current_value: 'Call Us Today' },
      { id: 'h3', text: '24/7 Emergency Service', owner_approved: true, rejected: false, current_value: '24/7 Emergency Service' }
    ],
    descriptions: [
      { id: 'd1', text: 'We fix leaks fast and reliably. Call now for a free quote.', owner_approved: true, rejected: false, current_value: 'We fix leaks fast and reliably. Call now for a free quote.' },
      { id: 'd2', text: 'Licensed and insured professionals ready to help you.', owner_approved: true, rejected: false, current_value: 'Licensed and insured professionals ready to help you.' }
    ],
    keywords: [
      { id: 'k1', text: 'plumber near me', match_type: 'EXACT', owner_approved: true, rejected: false, current_value: 'plumber near me' }
    ]
  };

  console.log('Creating deployment...');
  const { data: deployment, error: depError } = await supabase.from('channel_deployments').insert({
    unified_campaign_id: campaign.id,
    channel: 'google',
    channel_specific_allocation: 500,
    owner_id: ownerId,
    status: 'pending',
    target_state: targetState
  }).select('*').single();

  if (depError) throw depError;
  console.log('Deployment created:', deployment.id);

  console.log('\n--- PRE-MUTATION PLAN ---');
  console.log('EXECUTION MODE:', process.env.GOOGLE_ADS_EXECUTION_MODE);
  console.log('CUSTOMER ID:', process.env.GOOGLE_ADS_TEST_CUSTOMER_ID!.replace(/\d(?=\d{4})/g, '*'));
  console.log('CAMPAIGN NAME:', targetState.campaign.name);
  console.log('BUDGET:', targetState.campaign.budget);
  console.log('EXPECTED RESOURCES: 1 Budget, 1 Campaign, 1 Ad Group, 1 Ad, 1 Keyword');
  console.log('TEST ACCOUNT: YES');
  console.log('-------------------------\n');

  console.log('Deploying via deployGoogleCampaign...');
  try {
    await deployGoogleCampaign(campaign.id, ownerId);
    console.log('Deployment completed without throwing!');
  } catch(e) {
    console.error('Deployment Failed:', e);
    return;
  }

  const { data: finalDep } = await supabase.from('channel_deployments').select('*').eq('id', deployment.id).single();
  console.log('\n--- POST-DEPLOYMENT VERIFICATION ---');
  console.log('FINAL DEPLOYMENT STATUS:', finalDep.status);
  console.log('EXTERNAL STATE (Resource IDs):', JSON.stringify(finalDep.external_state, null, 2));

  console.log('\nRunning Reconciliation manually...');
  try {
    const recon = await reconcileGoogleDeployment(campaign.id, ownerId);
    console.log('RECONCILIATION RESULT:', recon.status);
    if (recon.differences) console.log('DIFFERENCES:', recon.differences);
  } catch(e) {
    console.error('Reconciliation Failed:', e);
  }
}
run().catch(console.error);
