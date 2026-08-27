-- 0004_campaign_metrics.sql
-- Daily per-campaign performance pulled from the Google Ads reporting API.
--
-- Read-only data: nothing here is ever written back to Google. Rows are keyed
-- by owner, Google campaign and date so a refresh can be re-run safely -- the
-- unique constraint below is what makes the nightly job idempotent.

create table public.campaign_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,

  -- Our campaign, when the Google campaign maps to one. Left null for spend on
  -- Google campaigns this app did not create, which still belongs in the totals.
  campaign_id uuid references public.unified_campaigns(id) on delete set null,

  -- Google's own campaign id, taken from the reporting response. This is the
  -- key the API actually returns, so it anchors the unique constraint.
  google_campaign_id text not null,
  google_campaign_name text,

  metric_date date not null,

  -- Google reports money in micros of the account currency: 1 unit = 1,000,000
  -- micros. cost_micros is kept exactly as returned so nothing is lost to
  -- rounding; cost_amount is the same figure in major units (rupees when
  -- currency_code is INR) for display and arithmetic.
  cost_micros bigint not null default 0,
  cost_amount numeric(14, 2) not null default 0,
  currency_code text not null default 'INR',

  impressions bigint not null default 0,
  clicks bigint not null default 0,
  conversions numeric(12, 2) not null default 0,

  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (owner_id, google_campaign_id, metric_date)
);

create index campaign_daily_metrics_owner_date_idx
  on public.campaign_daily_metrics (owner_id, metric_date desc);
create index campaign_daily_metrics_owner_campaign_idx
  on public.campaign_daily_metrics (owner_id, campaign_id);

alter table public.campaign_daily_metrics enable row level security;
create policy "owner_campaign_daily_metrics" on public.campaign_daily_metrics
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- Lead attribution
--
-- Leads arrive carrying Google's click id (gclid) and a free-text campaign
-- name typed by whatever tracking script runs on the salon website. A name
-- cannot be matched to a Google campaign id, so the reporting job resolves the
-- click id through Google's read-only click report and records the answer here.
-- Null means "not traceable to a campaign", which the performance page shows
-- as its own group rather than guessing.
-- ---------------------------------------------------------------------------

alter table public.leads
  add column if not exists attributed_google_campaign_id text,
  add column if not exists attribution_checked_at timestamptz;

create index if not exists leads_attributed_campaign_idx
  on public.leads (owner_id, attributed_google_campaign_id)
  where attributed_google_campaign_id is not null;

-- Lets the resolver find leads that still need a click-id lookup.
create index if not exists leads_attribution_pending_idx
  on public.leads (owner_id, attribution_checked_at)
  where gclid is not null and attributed_google_campaign_id is null;
