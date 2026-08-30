-- Failed-login throttle. Service-role only (no policies): the login action
-- has no session yet, so it cannot use owner RLS. Emails are stored as SHA-256
-- hashes, never in plaintext.

create table if not exists public.login_throttle (
  email_hash text primary key,
  attempt_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.login_throttle enable row level security;
