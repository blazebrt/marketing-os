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
