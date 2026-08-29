-- 0006_salon_marketing_os.sql
--
-- The marketing brain: who this salon is, what it sells, what the owner wants,
-- what the AI proposed, and what it recommends next.
--
-- Forward-only and idempotent. Adds tables only; nothing existing is altered or
-- dropped, so applying this to a populated database preserves all data.
--
-- Deliberately NOT here: staff, rosters, stock, invoices, appointments. This is
-- marketing context, not salon management.
--
-- Every table is owner-scoped with the same RLS shape as the rest of the schema.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.marketing_goal_type as enum (
    'MORE_BOOKINGS', 'MORE_NEW_CUSTOMERS', 'PROMOTE_SERVICE', 'PROMOTE_OFFER',
    'INCREASE_REVENUE', 'FILL_SLOW_DAYS', 'INCREASE_REPEAT_VISITS'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.marketing_plan_status as enum (
    'DRAFT', 'APPROVED', 'REJECTED', 'CONVERTED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.recommendation_status as enum (
    'OPEN', 'APPROVED', 'DISMISSED', 'DONE'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.confidence_level as enum ('HIGH', 'MEDIUM', 'LOW');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- salon_profile -- one row per owner. Marketing context only.
-- ---------------------------------------------------------------------------

create table if not exists public.salon_profile (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique,

  salon_name text,
  description text,
  location text,
  service_areas text[] not null default '{}',

  website_url text,
  booking_url text,
  whatsapp_number text,

  target_customer_types text[] not null default '{}',
  unique_selling_points text[] not null default '{}',
  brand_positioning text,
  preferred_tone text,

  -- Capacity, consumed if the owner supplies it. This app does not schedule
  -- appointments; it only avoids driving demand into an already-full day.
  slow_days text[] not null default '{}',
  busy_days text[] not null default '{}',

  default_destination_type text not null default 'WEBSITE'
    check (default_destination_type in ('WEBSITE', 'WHATSAPP', 'PHONE')),
  currency text not null default 'INR',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.salon_profile enable row level security;
drop policy if exists "owner_salon_profile" on public.salon_profile;
create policy "owner_salon_profile" on public.salon_profile
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- salon_services / salon_offers -- what there is to advertise.
-- ---------------------------------------------------------------------------

create table if not exists public.salon_services (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  category text,
  price numeric(12, 2),
  duration_minutes integer,
  -- Owner's own read on profitability. Never inferred by the AI.
  margin_tier text check (margin_tier in ('HIGH', 'MEDIUM', 'LOW')),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

create index if not exists salon_services_owner_active_idx
  on public.salon_services (owner_id, is_active);

alter table public.salon_services enable row level security;
drop policy if exists "owner_salon_services" on public.salon_services;
create policy "owner_salon_services" on public.salon_services
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create table if not exists public.salon_offers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  service_id uuid references public.salon_services(id) on delete set null,
  name text not null,
  description text,
  price numeric(12, 2),
  terms text,
  valid_from date,
  valid_to date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

create index if not exists salon_offers_owner_active_idx
  on public.salon_offers (owner_id, is_active);

alter table public.salon_offers enable row level security;
drop policy if exists "owner_salon_offers" on public.salon_offers;
create policy "owner_salon_offers" on public.salon_offers
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- marketing_goals -- what the owner asked for, in their words.
-- ---------------------------------------------------------------------------

create table if not exists public.marketing_goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  goal_type public.marketing_goal_type not null,
  description text,
  target_value numeric(12, 2),
  timeframe_days integer not null default 30,
  budget_amount numeric(12, 2),
  status text not null default 'OPEN' check (status in ('OPEN', 'PLANNED', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_goals_owner_status_idx
  on public.marketing_goals (owner_id, status, created_at desc);

alter table public.marketing_goals enable row level security;
drop policy if exists "owner_marketing_goals" on public.marketing_goals;
create policy "owner_marketing_goals" on public.marketing_goals
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- marketing_plans -- the AI's proposal, stored only after schema validation.
--
-- plan holds the validated MarketingPlan. Raw model output is never stored.
-- ---------------------------------------------------------------------------

create table if not exists public.marketing_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  goal_id uuid not null references public.marketing_goals(id) on delete cascade,
  status public.marketing_plan_status not null default 'DRAFT',
  plan jsonb not null,
  model text,
  campaign_id uuid references public.unified_campaigns(id) on delete set null,
  approved_at timestamptz,
  rejected_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_plans_owner_status_idx
  on public.marketing_plans (owner_id, status, created_at desc);
create index if not exists marketing_plans_goal_idx
  on public.marketing_plans (owner_id, goal_id);

alter table public.marketing_plans enable row level security;
drop policy if exists "owner_marketing_plans" on public.marketing_plans;
create policy "owner_marketing_plans" on public.marketing_plans
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- recommendations -- what to do next, with the evidence behind it.
--
-- A recommendation is a proposal only. Approving one records the owner's
-- decision; it never executes anything on its own.
-- ---------------------------------------------------------------------------

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  campaign_id uuid references public.unified_campaigns(id) on delete cascade,

  kind text not null,
  title text not null,
  what text not null,
  why text not null,
  evidence jsonb not null default '[]'::jsonb,
  confidence public.confidence_level not null,
  expected_impact text,
  risk text,
  required_action text not null,

  status public.recommendation_status not null default 'OPEN',
  -- What the numbers looked like when this was produced, so a stale
  -- recommendation can be recognised as stale.
  evidence_window jsonb not null default '{}'::jsonb,
  -- Stable identity for one finding, so a repeated analysis updates rather
  -- than piling up duplicates.
  fingerprint text not null,

  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (owner_id, fingerprint)
);

create index if not exists recommendations_owner_status_idx
  on public.recommendations (owner_id, status, created_at desc);

alter table public.recommendations enable row level security;
drop policy if exists "owner_recommendations" on public.recommendations;
create policy "owner_recommendations" on public.recommendations
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- ai_events -- observability for AI work.
--
-- Metadata only: counts, latency, model, outcome. Prompts and completions are
-- deliberately NOT stored, so salon or customer text cannot leak into logs.
-- ---------------------------------------------------------------------------

create table if not exists public.ai_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  event_type text not null,
  provider text,
  model text,
  latency_ms integer,
  success boolean not null default true,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_events_owner_created_idx
  on public.ai_events (owner_id, created_at desc);

alter table public.ai_events enable row level security;
drop policy if exists "owner_read_ai_events" on public.ai_events;
create policy "owner_read_ai_events" on public.ai_events
  for select using (auth.uid() = owner_id);
drop policy if exists "owner_insert_ai_events" on public.ai_events;
create policy "owner_insert_ai_events" on public.ai_events
  for insert with check (auth.uid() = owner_id);
-- Append-only: no update or delete policy, matching audit_logs.
