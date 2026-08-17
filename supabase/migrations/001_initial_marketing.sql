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
