-- 0001_initial_schema.sql
-- Authoritative schema for Marketing OS.
--
-- This replaces two earlier, mutually incompatible migration sets
-- (00001-00003 and 001-011). Those sets both created the same core tables,
-- so whichever ran first won and the later `create table if not exists`
-- statements silently became no-ops -- leaving a database whose columns did
-- not match what the application queries.
--
-- Every table, column, index, policy and constraint below is the shape the
-- application code in src/ actually reads and writes.
--
-- RLS is enabled and policed in the same file that creates each table, so no
-- table ever exists, even briefly, without its row-level security in place.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.lead_status as enum (
    'NEW', 'CONTACTED', 'BOOKED', 'VISITED', 'PAID', 'LOST', 'UNKNOWN'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.unified_campaign_status as enum (
    'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'READY_TO_DEPLOY',
    'ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED'
  );
exception when duplicate_object then null; end $$;

-- Includes the per-stage deployment states added by the old 010 migration.
do $$ begin
  create type public.channel_deployment_status as enum (
    'PENDING', 'PREPARING', 'READY_TO_DEPLOY', 'DEPLOYMENT_LOCKED',
    'CREATING_CAMPAIGN', 'CREATING_AD_GROUP', 'CREATING_ADS', 'CREATING_KEYWORDS',
    'VERIFYING', 'DEPLOYED', 'ACTIVE', 'PAUSED', 'FAILED'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- integrations -- client-readable metadata only. Never credentials.
-- ---------------------------------------------------------------------------

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  provider text not null check (provider in ('meta', 'google', 'whatsapp', 'instagram', 'website')),
  status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'error')),
  external_id text,
  last_verified_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, provider)
);

alter table public.integrations enable row level security;
create policy "owner_integrations" on public.integrations
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- integration_credentials -- encrypted secrets, server-only.
-- ---------------------------------------------------------------------------

create table public.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  provider text not null,
  encrypted_credentials text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, provider)
);

-- RLS on with NO policies: default-deny for anon and authenticated.
-- Only the service role (which bypasses RLS) can read or write credentials.
alter table public.integration_credentials enable row level security;

-- ---------------------------------------------------------------------------
-- oauth_states -- single-use OAuth state hashes, server-only.
-- ---------------------------------------------------------------------------

create table public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  provider text not null,
  state_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

-- RLS on with NO policies: service role only, same as integration_credentials.
alter table public.oauth_states enable row level security;

create index oauth_states_lookup_idx
  on public.oauth_states (owner_id, provider, state_hash);

-- ---------------------------------------------------------------------------
-- audit_logs -- append-only.
--
-- Two callers write here and they use different column names:
--   * logAudit() in src/lib/audit.ts writes actor/entity_type/entity_id/
--     before_state/after_state/reason
--   * rpc_approve_campaign and the creative actions write
--     resource_type/resource_id/details
-- Both column sets are kept, and only owner_id and action are required, so
-- neither writer breaks.
-- ---------------------------------------------------------------------------

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  action text not null,
  actor text,
  entity_type text,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  reason text,
  resource_type text,
  resource_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_owner_entity_idx on public.audit_logs (owner_id, entity_id);
create index audit_logs_owner_created_idx on public.audit_logs (owner_id, created_at desc);

-- Immutable: select and insert only. Update and delete are denied by the
-- absence of any policy granting them. Do not add one.
alter table public.audit_logs enable row level security;
create policy "owner_read_audit_logs" on public.audit_logs
  for select using (auth.uid() = owner_id);
create policy "owner_insert_audit_logs" on public.audit_logs
  for insert with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- unified_campaigns
-- ---------------------------------------------------------------------------

create table public.unified_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  service text not null,
  offer text not null,
  budget_type text not null check (budget_type in ('daily', 'total')),
  budget_amount numeric(15, 2) not null,
  duration_days int not null,
  max_daily_spend numeric(15, 2) not null,
  max_campaign_spend numeric(15, 2) not null,
  max_auto_budget_increase numeric(15, 2) not null default 0,
  destination text,
  destination_type text not null default 'WEBSITE'
    check (destination_type in ('WEBSITE', 'WHATSAPP', 'PHONE')),
  landing_url text,
  destination_verified_at timestamptz,
  destination_verification_status text,
  destination_verification_error text,
  channels text[] not null,
  creative_id text,
  status public.unified_campaign_status not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index unified_campaigns_owner_status_idx
  on public.unified_campaigns (owner_id, status);
create index unified_campaigns_owner_created_idx
  on public.unified_campaigns (owner_id, created_at desc);

alter table public.unified_campaigns enable row level security;
create policy "owner_unified_campaigns" on public.unified_campaigns
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- channel_deployments
-- ---------------------------------------------------------------------------

create table public.channel_deployments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  campaign_id uuid not null references public.unified_campaigns(id) on delete cascade,
  provider text not null check (provider in ('meta', 'google')),
  status public.channel_deployment_status not null default 'PENDING',
  target_state jsonb not null default '{}'::jsonb,
  actual_state jsonb not null default '{}'::jsonb,
  external_state jsonb not null default '{}'::jsonb,
  reconciliation_status text,
  failure_code text,
  failure_stage text,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, provider)
);

create index channel_deployments_owner_campaign_idx
  on public.channel_deployments (owner_id, campaign_id);

alter table public.channel_deployments enable row level security;
create policy "owner_channel_deployments" on public.channel_deployments
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- creatives -- one authoritative creative per campaign.
-- ---------------------------------------------------------------------------

create table public.creatives (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  campaign_id uuid references public.unified_campaigns(id) on delete cascade,
  name text not null,
  type text not null,
  file_url text,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'GENERATING', 'GENERATED', 'PARTIALLY_REVIEWED', 'APPROVED', 'REJECTED')),
  version integer not null default 1,
  generation_lock_until timestamptz,
  created_at timestamptz not null default now()
);

create unique index creatives_one_per_campaign
  on public.creatives (campaign_id) where campaign_id is not null;

alter table public.creatives enable row level security;
create policy "owner_creatives" on public.creatives
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- creatives_google / creatives_meta -- per-provider creative content.
-- ---------------------------------------------------------------------------

create table public.creatives_google (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  creative_id uuid not null references public.creatives(id) on delete cascade,
  google_asset_id text,
  headlines jsonb not null default '[]'::jsonb,
  descriptions jsonb not null default '[]'::jsonb,
  keywords jsonb not null default '[]'::jsonb,
  generation_status text not null default 'DRAFT',
  last_generated_at timestamptz,
  item_version integer not null default 1,
  created_at timestamptz not null default now()
);

create unique index creatives_google_creative_id_uidx
  on public.creatives_google (creative_id);

alter table public.creatives_google enable row level security;
create policy "owner_creatives_google" on public.creatives_google
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create table public.creatives_meta (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  creative_id uuid not null references public.creatives(id) on delete cascade,
  meta_image_hash text,
  created_at timestamptz not null default now(),
  unique (creative_id)
);

alter table public.creatives_meta enable row level security;
create policy "owner_creatives_meta" on public.creatives_meta
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- marketing_interactions -- first-touch attribution.
-- ---------------------------------------------------------------------------

create table public.marketing_interactions (
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
  unique (owner_id, session_id, interaction_type)
);

create index marketing_interactions_owner_session_idx
  on public.marketing_interactions (owner_id, session_id);

alter table public.marketing_interactions enable row level security;
create policy "owner_marketing_interactions" on public.marketing_interactions
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  external_lead_id text,
  name text,
  phone text,
  normalized_phone text,
  email text,
  normalized_email text,
  status public.lead_status not null default 'NEW',
  revenue_amount numeric(12, 2) not null default 0,
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

create unique index leads_external_idx
  on public.leads (owner_id, external_lead_id) where external_lead_id is not null;
create index leads_phone_idx
  on public.leads (owner_id, normalized_phone) where normalized_phone is not null;
create index leads_email_idx
  on public.leads (owner_id, normalized_email) where normalized_email is not null;
create index leads_owner_status_idx on public.leads (owner_id, status);
create index leads_owner_created_idx on public.leads (owner_id, created_at desc);

alter table public.leads enable row level security;
create policy "owner_leads" on public.leads
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- idempotency_keys -- withIdempotency() in src/lib/idempotency.ts.
-- ---------------------------------------------------------------------------

create table public.idempotency_keys (
  id text primary key,
  owner_id uuid not null,
  resource_type text not null,
  status text not null check (status in ('processing', 'completed', 'failed')),
  response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.idempotency_keys enable row level security;
create policy "owner_idempotency_keys" on public.idempotency_keys
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- generation_rate_events -- rate limiting for AI creative generation.
-- ---------------------------------------------------------------------------

create table public.generation_rate_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  campaign_id uuid not null,
  created_at timestamptz not null default now()
);

create index generation_rate_events_owner_created
  on public.generation_rate_events (owner_id, created_at desc);
create index generation_rate_events_campaign_created
  on public.generation_rate_events (campaign_id, created_at desc);

alter table public.generation_rate_events enable row level security;
create policy "owner_generation_rate_events" on public.generation_rate_events
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
