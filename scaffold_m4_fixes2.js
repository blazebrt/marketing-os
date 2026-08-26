const fs = require('fs');
const path = require('path');

const write = (p, content) => {
  const full = path.join(process.cwd(), p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.trim() + '\n', 'utf-8');
};

write('supabase/migrations/007_milestone4_rpc.sql', `
-- Clarify creative architecture
-- public.creatives is the single authoritative shared registry.
create table if not exists public.creatives_meta (
    id uuid primary key default gen_random_uuid(),
    creative_id uuid not null references public.creatives(id) on delete cascade,
    owner_id uuid not null,
    meta_image_hash text,
    created_at timestamptz not null default now()
);

create table if not exists public.creatives_google (
    id uuid primary key default gen_random_uuid(),
    creative_id uuid not null references public.creatives(id) on delete cascade,
    owner_id uuid not null,
    google_asset_id text,
    created_at timestamptz not null default now()
);

alter table public.creatives_meta enable row level security;
create policy "owner_creatives_meta" on public.creatives_meta for all using (auth.uid() = owner_id);

alter table public.creatives_google enable row level security;
create policy "owner_creatives_google" on public.creatives_google for all using (auth.uid() = owner_id);

-- Explicit RPC for atomic, idempotent fail-closed state transitions
create or replace function public.rpc_approve_campaign(p_campaign_id uuid, p_owner_id uuid)
returns json language plpgsql security invoker as $$
declare
    v_campaign record;
    v_provider text;
    v_deployment_count int;
begin
    -- 1. Lock and Verify Status
    select * into v_campaign
    from public.unified_campaigns
    where id = p_campaign_id and owner_id = p_owner_id
    for update;

    if not found then
        raise exception 'Campaign not found or unauthorized';
    end if;

    if v_campaign.status != 'PENDING_APPROVAL' then
        raise exception 'Campaign must be in PENDING_APPROVAL state';
    end if;

    -- 2. Transition to APPROVED
    update public.unified_campaigns
    set status = 'APPROVED', updated_at = now()
    where id = p_campaign_id;

    -- 3. Idempotently create deployments
    if array_length(v_campaign.channels, 1) is not null then
        foreach v_provider in array v_campaign.channels loop
            insert into public.channel_deployments (campaign_id, owner_id, provider, status)
            values (p_campaign_id, p_owner_id, lower(v_provider), 'PENDING')
            on conflict (campaign_id, provider) do nothing;
        end loop;
    end if;

    -- 4. Verify deployments exist for every channel and belong to same owner
    select count(*) into v_deployment_count
    from public.channel_deployments
    where campaign_id = p_campaign_id and owner_id = p_owner_id;

    if v_deployment_count != coalesce(array_length(v_campaign.channels, 1), 0) then
        raise exception 'Partial or invalid deployment mapping detected';
    end if;

    -- 5. Final Transition to READY_TO_DEPLOY
    update public.unified_campaigns
    set status = 'READY_TO_DEPLOY', updated_at = now()
    where id = p_campaign_id;

    return json_build_object('success', true);
end;
$$;
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
    creative_id: null, // UI removed it, force null
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
  
  try {
    calculateSafetyLimits(campaign.budget_type, Number(campaign.budget_amount), campaign.duration_days);
    checks.push({ name: 'Budget & Duration', pass: true, message: 'Budget and duration are within configured safety bounds' });
  } catch (e: any) {
    checks.push({ name: 'Budget & Duration', pass: false, message: e.message });
  }

  if (!campaign.creative_id) {
    checks.push({ name: 'Creative', pass: false, message: 'No creative attached' });
  } else {
    const { data: cr } = await supabase.from('creatives').select('id').eq('id', campaign.creative_id).eq('owner_id', user.id).single();
    if (cr) {
      checks.push({ name: 'Creative', pass: true, message: 'Creative record verified' });
    } else {
      checks.push({ name: 'Creative', pass: false, message: 'Creative record not found or inaccessible' });
    }
  }

  if (campaign.destination) {
    checks.push({ name: 'Destination', pass: true, message: 'Destination configured' });
  } else {
    checks.push({ name: 'Destination', pass: false, message: 'Missing destination' });
  }

  const { data: creds } = await supabase.from('integrations').select('provider').eq('owner_id', user.id).eq('status', 'connected');
  const connectedProviders = creds?.map((c: any) => c.provider.toLowerCase()) || [];
  
  if (!campaign.channels || campaign.channels.length === 0) {
    checks.push({ name: 'Channels', pass: false, message: 'No channels selected' });
  } else {
    for (const channel of campaign.channels) {
      if (connectedProviders.includes(channel.toLowerCase())) {
        checks.push({ name: \`Integration: \${channel}\`, pass: true, message: \`\${channel} connection verified via safe metadata\` });
      } else {
        checks.push({ name: \`Integration: \${channel}\`, pass: false, message: \`\${channel} is disconnected or missing\` });
      }
    }
  }

  if (campaign.destination?.toLowerCase().includes('website')) {
    if (connectedProviders.includes('website')) {
      checks.push({ name: 'Tracking Readiness', pass: true, message: 'Website tracking integration is active' });
    } else {
      checks.push({ name: 'Tracking Readiness', pass: false, message: 'Website tracking required but disconnected' });
    }
  } else {
    checks.push({ name: 'Tracking Readiness', pass: true, message: 'No explicit tracking setup required for this destination' });
  }

  const allPass = checks.every(c => c.pass);
  await logAudit(user.id, 'PRELAUNCH_VERIFICATION', 'campaign', campaignId, null, null, \`Verification \${allPass ? 'Passed' : 'Failed'}\`);
  
  return { checks, allPass };
}

export async function requestApproval(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const verification = await verifyCampaign(campaignId);
  if (!verification.allPass) {
    throw new Error('Prelaunch verification failed. Cannot request approval.');
  }

  const { error, data } = await supabase.from('unified_campaigns')
    .update({ status: 'PENDING_APPROVAL', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('owner_id', user.id)
    .eq('status', 'DRAFT')
    .select('id').single();

  if (error || !data) throw new Error('State transition to PENDING_APPROVAL failed (must be in DRAFT state)');

  await logAudit(user.id, 'CAMPAIGN_SUBMITTED_FOR_APPROVAL', 'campaign', campaignId, null, null, 'DRAFT -> PENDING_APPROVAL');
  revalidatePath('/campaigns');
  revalidatePath(\`/campaigns/\${campaignId}\`);
}

export async function approveCampaign(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const verification = await verifyCampaign(campaignId);
  if (!verification.allPass) {
    throw new Error('Prelaunch verification failed. Cannot approve.');
  }

  // Atomic state transition and deployments mapping via RPC
  const { data, error } = await supabase.rpc('rpc_approve_campaign', {
    p_campaign_id: campaignId,
    p_owner_id: user.id
  });

  if (error || !data?.success) {
    throw new Error(error?.message || 'Deployment mapping or state transition failed transactionally.');
  }

  await logAudit(user.id, 'CAMPAIGN_APPROVED', 'campaign', campaignId, null, null, 'Campaign approved explicitly by owner');
  await logAudit(user.id, 'CAMPAIGN_STATE_CHANGED', 'campaign', campaignId, null, null, 'APPROVED -> READY_TO_DEPLOY');
  
  revalidatePath('/campaigns');
  revalidatePath(\`/campaigns/\${campaignId}\`);
  return true;
}
`);
console.log('Backend edits done.');
