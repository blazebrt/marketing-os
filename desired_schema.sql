create extension if not exists pgcrypto;

-- 1. Integrations
create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  provider text not null check (provider in ('meta', 'google', 'whatsapp')),
  status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'error')),
  credentials jsonb, 
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, provider)
);

-- 2. Audit Logs (Immutable)
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  reason text,
  created_at timestamptz not null default now()
);

-- 3. Unified Campaigns
create table if not exists public.unified_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  service text not null,
  offer text not null,
  budget_type text not null check (budget_type in ('daily', 'total')),
  budget_amount numeric(12,2) not null,
  max_daily_spend numeric(12,2) not null,
  max_campaign_spend numeric(12,2) not null,
  max_auto_budget_increase numeric(12,2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'active', 'paused', 'completed')),
  start_at timestamptz,
  end_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. Channel Deployments
create table if not exists public.channel_deployments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  unified_campaign_id uuid references public.unified_campaigns(id) on delete cascade,
  channel text not null check (channel in ('meta', 'google')),
  channel_specific_allocation numeric(12,2) not null,
  status text not null default 'pending' check (status in ('pending', 'syncing', 'active', 'paused', 'error')),
  external_campaign_id text,
  target_state jsonb,
  reconciliation_status text not null default 'ready_for_sync',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(unified_campaign_id, channel)
);

-- 5. Creatives (Google)
create table if not exists public.creatives_google (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  channel_deployment_id uuid references public.channel_deployments(id) on delete cascade,
  headlines jsonb not null default '[]',
  descriptions jsonb not null default '[]',
  keywords jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel_deployment_id)
);

-- 6. Creatives (Meta)
create table if not exists public.creatives_meta (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  channel_deployment_id uuid references public.channel_deployments(id) on delete cascade,
  media_url text not null,
  format text not null check (format in ('image', 'video', 'carousel')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel_deployment_id)
);

-- 7. Marketing Interactions
create table if not exists public.marketing_interactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  session_id text not null,
  type text not null check (type in ('website_visit', 'whatsapp_click', 'phone_click', 'lead_form_open')),
  url text,
  fbclid text,
  gclid text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  campaign_id uuid references public.unified_campaigns(id) on delete set null,
  channel_deployment_id uuid references public.channel_deployments(id) on delete set null,
  creative_id text,
  created_at timestamptz not null default now()
);

-- 8. Leads
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  session_id text,
  normalized_phone text,
  normalized_email text,
  name text not null,
  phone text,
  email text,
  source text not null check (source in ('meta', 'google', 'website', 'whatsapp', 'phone')),
  status text not null default 'new' check (status in ('new', 'contacted', 'booked', 'visited', 'paid', 'lost', 'unknown')),
  revenue numeric(12,2) default 0,
  marketing_interaction_id uuid references public.marketing_interactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 9. Idempotency Keys
create table if not exists public.idempotency_keys (
  id text primary key,
  owner_id uuid not null,
  resource_type text not null,
  status text not null check (status in ('processing', 'completed', 'failed')),
  response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index on public.leads(owner_id, status);
create index on public.unified_campaigns(owner_id, status);
create index on public.marketing_interactions(owner_id, session_id);
create index on public.audit_logs(owner_id, entity_id);

-- RLS Enforcement
alter table public.integrations enable row level security;
alter table public.audit_logs enable row level security;
alter table public.unified_campaigns enable row level security;
alter table public.channel_deployments enable row level security;
alter table public.creatives_google enable row level security;
alter table public.creatives_meta enable row level security;
alter table public.marketing_interactions enable row level security;
alter table public.leads enable row level security;
alter table public.idempotency_keys enable row level security;

-- Owner Policies (Only Authenticated users matching owner_id can access)

-- Integrations
create policy "Owner full access integrations" on public.integrations for all using (auth.uid() = owner_id);

-- Audit Logs (Immutable: Insert and Select only)
create policy "Owner read audit_logs" on public.audit_logs for select using (auth.uid() = owner_id);
create policy "Owner insert audit_logs" on public.audit_logs for insert with check (auth.uid() = owner_id);
-- Explicitly deny update/delete (by omitting them, default deny applies)

-- Unified Campaigns
create policy "Owner full access unified_campaigns" on public.unified_campaigns for all using (auth.uid() = owner_id);

-- Channel Deployments
create policy "Owner full access channel_deployments" on public.channel_deployments for all using (auth.uid() = owner_id);

-- Creatives
create policy "Owner full access creatives_google" on public.creatives_google for all using (auth.uid() = owner_id);
create policy "Owner full access creatives_meta" on public.creatives_meta for all using (auth.uid() = owner_id);

-- Interactions & Leads
create policy "Owner full access marketing_interactions" on public.marketing_interactions for all using (auth.uid() = owner_id);
create policy "Owner full access leads" on public.leads for all using (auth.uid() = owner_id);

-- Idempotency
create policy "Owner full access idempotency_keys" on public.idempotency_keys for all using (auth.uid() = owner_id);


-- 1. Remove credentials from integrations (preventing client leakage)
alter table public.integrations drop column if exists credentials;
alter table public.integrations add column if not exists external_id text;
alter table public.integrations add column if not exists last_verified_at timestamptz;
alter table public.integrations add column if not exists error_message text;

-- 2. Create secure credentials table
create table public.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  provider text not null,
  encrypted_credentials text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, provider)
);

-- 3. Enforce Strict Server-Only RLS
alter table public.integration_credentials enable row level security;
-- NO policies are created for anon or authenticated users. 
-- This guarantees Default Deny, meaning ONLY service_role can read/write this table.


-- 1. Create oauth_states table for cryptographically secure, single-use state
create table public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  provider text not null,
  state_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

-- 2. Prevent client exposure
alter table public.oauth_states enable row level security;
-- NO policies are created for anon or authenticated users. 
-- ONLY service_role can read/write this table.


-- Enums
do $$ begin
    create type lead_status as enum ('NEW', 'CONTACTED', 'BOOKED', 'VISITED', 'PAID', 'LOST', 'UNKNOWN');
exception
    when duplicate_object then null;
end $$;

create table if not exists public.marketing_interactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  session_id text not null,
  interaction_type text not null,
  source text,
  campaign_name text,
  ad_group_name text,
  ad_name text,
  creative_id text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  fbclid text,
  gclid text,
  landing_page text,
  created_at timestamptz not null default now(),
  unique(owner_id, session_id, interaction_type)
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  external_lead_id text,
  name text,
  phone text,
  normalized_phone text,
  email text,
  normalized_email text,
  status lead_status not null default 'NEW',
  revenue_amount numeric(10, 2) not null default 0,
  source_channel text,
  campaign_name text,
  ad_group_name text,
  ad_name text,
  creative_id text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  fbclid text,
  gclid text,
  landing_session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists leads_external_idx on public.leads(owner_id, external_lead_id) where external_lead_id is not null;
create index if not exists leads_phone_idx on public.leads(owner_id, normalized_phone) where normalized_phone is not null;
create index if not exists leads_email_idx on public.leads(owner_id, normalized_email) where normalized_email is not null;

alter table public.marketing_interactions enable row level security;
create policy "owner_interactions" on public.marketing_interactions for all using (auth.uid() = owner_id);

alter table public.leads enable row level security;
create policy "owner_leads" on public.leads for all using (auth.uid() = owner_id);


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


-- Create real creatives table for verification
create table if not exists public.creatives (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  type text not null,
  file_url text,
  created_at timestamptz not null default now()
);

alter table public.creatives enable row level security;
create policy "owner_creatives" on public.creatives for all using (auth.uid() = owner_id);

-- Explicit audit_logs if not already fully defined (to ensure idempotent testing)
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details text,
  created_at timestamptz not null default now()
);

-- Note: No need to modify unified_campaigns, it already has creative_id text.


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


create or replace function public.rpc_approve_campaign(p_campaign_id uuid, p_owner_id uuid)
returns json language plpgsql security invoker as $$
declare
    v_uid uuid;
    v_owner_id uuid;
    v_campaign record;
    v_provider text;
    v_requested_providers text[];
    v_deployed_providers text[];
    v_missing_integrations int;
    
    v_calc_daily numeric(15, 2);
    v_calc_total numeric(15, 2);
begin
    -- 1. Security & Identity
    v_uid := auth.uid();
    
    if v_uid is null then
        raise exception 'Unauthorized: No authenticated user';
    end if;
    
    if v_uid != p_owner_id then
        raise exception 'Unauthorized: Caller UID does not match requested owner_id';
    end if;
    
    v_owner_id := v_uid;

    -- 2. Lock Campaign
    select * into v_campaign
    from public.unified_campaigns
    where id = p_campaign_id and owner_id = v_owner_id
    for update;

    if not found then
        raise exception 'Campaign not found or unauthorized';
    end if;

    if v_campaign.status != 'PENDING_APPROVAL' then
        raise exception 'Campaign must be in PENDING_APPROVAL state';
    end if;

    -- 3. Strict Prelaunch Transactional Validation (TOCTOU protection)
    
    -- Budget & Duration Safety Validation
    if v_campaign.budget_amount <= 0 then
        raise exception 'Negative or zero budget';
    end if;
    
    if v_campaign.duration_days <= 0 then
        raise exception 'Invalid duration';
    end if;
    
    if v_campaign.budget_type not in ('daily', 'total') then
        raise exception 'Invalid budget type';
    end if;
    
    -- Calculate expected limits
    if v_campaign.budget_type = 'daily' then
        v_calc_daily := v_campaign.budget_amount;
        v_calc_total := v_campaign.budget_amount * v_campaign.duration_days;
    else
        v_calc_total := v_campaign.budget_amount;
        v_calc_daily := v_campaign.budget_amount / v_campaign.duration_days;
    end if;
    
    -- Enforce absolute system safety ceilings
    if v_calc_daily > 50000 then
        raise exception 'Daily spend exceeds safety limit';
    end if;
    if v_calc_total > 500000 then
        raise exception 'Total spend exceeds safety limit';
    end if;
    
    -- Reject inconsistent/tampered stored limits
    if v_campaign.max_daily_spend != v_calc_daily then
        raise exception 'Tampered max_daily_spend';
    end if;
    if v_campaign.max_campaign_spend != v_calc_total then
        raise exception 'Tampered max_campaign_spend';
    end if;
    if coalesce(v_campaign.max_auto_budget_increase, 0) != 0 then
        raise exception 'Tampered max_auto_budget_increase';
    end if;

    -- Creative and Destination Validation
    if v_campaign.creative_id is null then
        raise exception 'Creative must be assigned';
    end if;
    -- Note: creative_id references public.creatives which uses uuid, but schema could use text. 
    -- Assuming UUID cast for strictness since we are validating ownership:
    if not exists (select 1 from public.creatives where id = v_campaign.creative_id::uuid and owner_id = v_owner_id) then
        raise exception 'Creative not found or unauthorized';
    end if;
    if coalesce(v_campaign.destination, '') = '' then
        raise exception 'Destination must be set';
    end if;

    -- Normalize requested providers and check integrations
    if array_length(v_campaign.channels, 1) is null or array_length(v_campaign.channels, 1) = 0 then
        raise exception 'No channels selected';
    end if;

    select array_agg(lower(c) order by lower(c)) into v_requested_providers
    from unnest(v_campaign.channels) as c;

    select count(*) into v_missing_integrations
    from unnest(v_requested_providers) as p
    where not exists (
        select 1 from public.integrations
        where owner_id = v_owner_id and lower(provider) = p and status = 'connected'
    );

    if v_missing_integrations > 0 then
        raise exception 'Missing connected integration for one or more selected channels';
    end if;

    if lower(v_campaign.destination) like '%website%' then
        if not exists (select 1 from public.integrations where owner_id = v_owner_id and lower(provider) = 'website' and status = 'connected') then
            raise exception 'Website destination requires connected website tracking integration';
        end if;
    end if;

    -- 4. Transition to APPROVED (Logic)
    update public.unified_campaigns
    set status = 'APPROVED', updated_at = now()
    where id = p_campaign_id;

    -- 5. Idempotently create deployments
    foreach v_provider in array v_requested_providers loop
        insert into public.channel_deployments (campaign_id, owner_id, provider, status)
        values (p_campaign_id, v_owner_id, v_provider, 'PENDING')
        on conflict (campaign_id, provider) do nothing;
    end loop;

    -- 6. Verify deployments EXACT SET match
    select array_agg(lower(provider) order by lower(provider)) into v_deployed_providers
    from public.channel_deployments
    where campaign_id = p_campaign_id and owner_id = v_owner_id;

    if v_deployed_providers is distinct from v_requested_providers then
        raise exception 'Exact deployment mapping mismatch';
    end if;

    -- 7. Final Transition to READY_TO_DEPLOY
    update public.unified_campaigns
    set status = 'READY_TO_DEPLOY', updated_at = now()
    where id = p_campaign_id;

    -- 8. Transactional Audit Log
    insert into public.audit_logs (owner_id, action, resource_type, resource_id, details)
    values
    (v_owner_id, 'CAMPAIGN_APPROVED', 'campaign', p_campaign_id, '{"reason": "Campaign explicitly approved by owner"}'),
    (v_owner_id, 'CAMPAIGN_STATE_CHANGED', 'campaign', p_campaign_id, '{"transition": "APPROVED -> READY_TO_DEPLOY"}');

    return json_build_object('success', true);
end;
$$;


alter table public.creatives_google
add column if not exists headlines jsonb not null default '[]'::jsonb,
add column if not exists descriptions jsonb not null default '[]'::jsonb,
add column if not exists keywords jsonb not null default '[]'::jsonb;


-- 010_milestone6_deployment.sql

-- Add new states to channel_deployment_status if they don't exist
do $$ begin
  alter type channel_deployment_status add value 'READY_TO_DEPLOY';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type channel_deployment_status add value 'DEPLOYMENT_LOCKED';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type channel_deployment_status add value 'CREATING_CAMPAIGN';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type channel_deployment_status add value 'CREATING_AD_GROUP';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type channel_deployment_status add value 'CREATING_ADS';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type channel_deployment_status add value 'CREATING_KEYWORDS';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type channel_deployment_status add value 'VERIFYING';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type channel_deployment_status add value 'ACTIVE';
exception when duplicate_object then null; end $$;

-- Add new tracking columns to channel_deployments
alter table public.channel_deployments
add column if not exists external_state jsonb not null default '{}'::jsonb,
add column if not exists failure_code text,
add column if not exists failure_stage text,
add column if not exists locked_at timestamptz,
add column if not exists locked_by text;
