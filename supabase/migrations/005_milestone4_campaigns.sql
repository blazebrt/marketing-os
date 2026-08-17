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
