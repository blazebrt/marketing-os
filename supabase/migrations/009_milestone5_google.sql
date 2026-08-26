alter table public.creatives_google
add column if not exists headlines jsonb not null default '[]'::jsonb,
add column if not exists descriptions jsonb not null default '[]'::jsonb,
add column if not exists keywords jsonb not null default '[]'::jsonb;
