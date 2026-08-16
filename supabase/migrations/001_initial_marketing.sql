create extension if not exists pgcrypto;

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  service text not null,
  offer text not null,
  daily_budget numeric(12,2) not null default 0,
  duration_days integer not null default 1,
  creative_mode text not null check (creative_mode in ('existing','generate')),
  destination text not null check (destination in ('lead_form','whatsapp','website')),
  status text not null default 'draft' check (status in ('draft','pending_approval','active','paused','completed')),
  meta_campaign_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete set null,
  name text not null,
  phone text not null,
  service text,
  preferred_date date,
  preferred_time text,
  source text,
  medium text,
  campaign_attribution text,
  content_attribution text,
  status text not null default 'new' check (status in ('new','contacted','booked','visited','lost')),
  revenue numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_campaign_id_idx on public.leads(campaign_id);
create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_created_at_idx on public.leads(created_at desc);

alter table public.campaigns enable row level security;
alter table public.leads enable row level security;
