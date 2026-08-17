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
