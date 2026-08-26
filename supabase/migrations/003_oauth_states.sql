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
