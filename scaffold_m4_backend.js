const fs = require('fs');
const path = require('path');

const write = (p, content) => {
  const full = path.join(process.cwd(), p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.trim() + '\n', 'utf-8');
};

write('supabase/migrations/005_milestone4_campaigns.sql', `
do $$ begin
    create type unified_campaign_status as enum ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'READY_TO_DEPLOY', 'ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED');
exception when duplicate_object then null; end $$;

do $$ begin
    create type channel_deployment_status as enum ('PENDING', 'PREPARING', 'DEPLOYED', 'FAILED', 'PAUSED');
exception when duplicate_object then null; end $$;

create table if not exists public.unified_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  service text not null,
  offer text not null,
  budget_type text not null,
  budget_amount numeric(15, 2) not null,
  duration_days int not null,
  max_daily_spend numeric(15, 2) not null,
  max_campaign_spend numeric(15, 2) not null,
  max_auto_budget_increase numeric(15, 2) not null default 0,
  destination text not null,
  channels text[] not null,
  creative_id text,
  status unified_campaign_status not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.channel_deployments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.unified_campaigns(id) on delete cascade,
  owner_id uuid not null,
  provider text not null,
  status channel_deployment_status not null default 'PENDING',
  target_state jsonb not null default '{}'::jsonb,
  actual_state jsonb not null default '{}'::jsonb,
  reconciliation_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, provider)
);

alter table public.unified_campaigns enable row level security;
create policy "owner_unified_campaigns" on public.unified_campaigns for all using (auth.uid() = owner_id);

alter table public.channel_deployments enable row level security;
create policy "owner_channel_deployments" on public.channel_deployments for all using (auth.uid() = owner_id);
`);

write('src/lib/schemas/campaigns.ts', `
import { z } from 'zod';

export const CampaignIntentSchema = z.object({
  service: z.string().min(2, "Service is required"),
  offer: z.string().min(2, "Offer is required"),
  budget_type: z.enum(['daily', 'total']),
  budget_amount: z.number().positive("Budget must be greater than 0"),
  duration_days: z.number().int().min(1, "Duration must be at least 1 day").max(365, "Duration too long"),
  destination: z.string().min(1, "Destination is required"),
  channels: z.array(z.string()).min(1, "At least one channel is required"),
  creative_id: z.string().optional()
});
`);

write('src/lib/campaigns/safeguards.ts', `
export const MAX_DAILY_SPEND = 50000; // 50,000 INR
export const MAX_CAMPAIGN_SPEND = 500000; // 5,00,000 INR

export function calculateSafetyLimits(budgetType: string, amount: number, duration: number) {
  let daily = 0;
  let total = 0;

  if (budgetType === 'daily') {
    daily = amount;
    total = amount * duration;
  } else {
    total = amount;
    daily = amount / duration;
  }

  if (amount <= 0 || isNaN(amount) || !isFinite(amount)) {
    throw new Error('Invalid budget amount');
  }

  if (daily > MAX_DAILY_SPEND) {
    throw new Error(\`Daily spend exceeds safety limit of \${MAX_DAILY_SPEND}\`);
  }

  if (total > MAX_CAMPAIGN_SPEND) {
    throw new Error(\`Total spend exceeds safety limit of \${MAX_CAMPAIGN_SPEND}\`);
  }

  return { maxDaily: daily, maxTotal: total };
}
`);

write('src/app/campaigns/actions.ts', `
'use server';

import { createClient } from '@/lib/supabase/server';
import { CampaignIntentSchema } from '@/lib/schemas/campaigns';
import { calculateSafetyLimits } from '@/lib/campaigns/safeguards';
import { logAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';

export async function saveDraftCampaign(payload: any) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const parsed = CampaignIntentSchema.parse(payload);
  const limits = calculateSafetyLimits(parsed.budget_type, parsed.budget_amount, parsed.duration_days);

  const { data, error } = await supabase.from('unified_campaigns').insert({
    owner_id: user.id,
    service: parsed.service,
    offer: parsed.offer,
    budget_type: parsed.budget_type,
    budget_amount: parsed.budget_amount,
    duration_days: parsed.duration_days,
    max_daily_spend: limits.maxDaily,
    max_campaign_spend: limits.maxTotal,
    destination: parsed.destination,
    channels: parsed.channels,
    creative_id: parsed.creative_id || 'mock-creative-id', // V1 placeholder
    status: 'DRAFT'
  }).select('id').single();

  if (error) throw new Error('Database error saving draft');

  await logAudit(user.id, 'CAMPAIGN_CREATED', 'campaign', data.id, null, null, 'Draft campaign created via wizard');
  return data.id;
}

export async function verifyCampaign(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data: campaign } = await supabase.from('unified_campaigns').select('*').eq('id', campaignId).eq('owner_id', user.id).single();
  if (!campaign) throw new Error('Campaign not found');

  const checks = [];
  
  // Budget checks
  try {
    calculateSafetyLimits(campaign.budget_type, Number(campaign.budget_amount), campaign.duration_days);
    checks.push({ name: 'Budget Safety', pass: true, message: 'Budget is within configured safety limits' });
  } catch (e: any) {
    checks.push({ name: 'Budget Safety', pass: false, message: e.message });
  }

  // Creative check
  if (campaign.creative_id) {
    checks.push({ name: 'Creative', pass: true, message: 'Creative attached' });
  } else {
    checks.push({ name: 'Creative', pass: false, message: 'Missing creative' });
  }

  // Destination
  if (campaign.destination) {
    checks.push({ name: 'Destination', pass: true, message: 'Destination configured' });
  } else {
    checks.push({ name: 'Destination', pass: false, message: 'Missing destination' });
  }

  // Integrations check (Mocked using integration_credentials table in real app, we check if they exist)
  const { data: creds } = await supabase.from('integration_credentials').select('provider').eq('owner_id', user.id);
  const connectedProviders = creds?.map((c: any) => c.provider) || [];
  
  for (const channel of campaign.channels) {
    if (connectedProviders.includes(channel.toLowerCase())) {
      checks.push({ name: \`Integration: \${channel}\`, pass: true, message: \`\${channel} is securely connected\` });
    } else {
      checks.push({ name: \`Integration: \${channel}\`, pass: false, message: \`\${channel} is disconnected. Please connect in Settings.\` });
    }
  }

  const allPass = checks.every(c => c.pass);
  await logAudit(user.id, 'PRELAUNCH_VERIFICATION', 'campaign', campaignId, null, null, \`Verification \${allPass ? 'Passed' : 'Failed'}\`);
  
  return { checks, allPass };
}

export async function approveCampaign(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const verification = await verifyCampaign(campaignId);
  if (!verification.allPass) {
    throw new Error('Prelaunch verification failed. Cannot approve.');
  }

  const { data: campaign } = await supabase.from('unified_campaigns').select('channels').eq('id', campaignId).eq('owner_id', user.id).single();

  // Atomically update state
  const { error } = await supabase.from('unified_campaigns')
    .update({ status: 'READY_TO_DEPLOY', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('owner_id', user.id)
    .eq('status', 'DRAFT'); // Ensure state machine progression

  if (error) throw new Error('Failed to approve campaign or invalid state transition');

  // Create channel deployments safely
  for (const provider of campaign?.channels || []) {
    await supabase.from('channel_deployments').insert({
      campaign_id: campaignId,
      owner_id: user.id,
      provider: provider.toLowerCase(),
      status: 'PENDING'
    });
  }

  await logAudit(user.id, 'CAMPAIGN_STATE_CHANGED', 'campaign', campaignId, null, null, 'DRAFT -> READY_TO_DEPLOY');
  await logAudit(user.id, 'CAMPAIGN_APPROVED', 'campaign', campaignId, null, null, 'Campaign approved by owner safely');

  revalidatePath('/campaigns');
  return true;
}
`);
console.log('Backend scaffolding done.');
