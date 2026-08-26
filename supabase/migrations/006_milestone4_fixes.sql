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
