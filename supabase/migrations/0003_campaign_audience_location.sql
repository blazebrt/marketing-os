-- 0003_campaign_audience_location.sql
-- Adds the two campaign description fields the creative generator needs to
-- write locally specific copy: who the campaign is for, and which area it
-- should target. Both are owner-entered free text and both are optional, so
-- existing campaigns stay valid.

alter table public.unified_campaigns
  add column if not exists target_audience text,
  add column if not exists location text;
