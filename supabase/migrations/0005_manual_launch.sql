-- 0005_manual_launch.sql
-- What the manual launch path needs: somewhere to record the Google campaign
-- id the owner created by hand, and a campaign state meaning "running".
--
-- One-click launch stays disabled behind the mutation gate. This is the route a
-- campaign takes instead: the owner builds it in Google Ads themselves, pastes
-- the id back, and the reporting layer picks it up from there.

-- ---------------------------------------------------------------------------
-- channel_deployments.external_campaign_id
--
-- This column was lost when the two competing migration sets were consolidated:
-- the older set defined it, the newer one did not, and the newer one was taken
-- as authoritative. The reporting layer added afterwards reads and writes it,
-- so without this it fails against a real database.
--
-- It holds Google's own campaign id as digits, which is the key the reporting
-- API returns and therefore the join between a campaign here and its spend.
-- ---------------------------------------------------------------------------

alter table public.channel_deployments
  add column if not exists external_campaign_id text;

create index if not exists channel_deployments_external_campaign_idx
  on public.channel_deployments (owner_id, external_campaign_id)
  where external_campaign_id is not null;

-- ---------------------------------------------------------------------------
-- LIVE
--
-- The campaign exists in Google Ads and its id has been recorded. The enum
-- already carried ACTIVE, but nothing ever set it on a campaign -- it is only
-- used for channel_deployments. LIVE is the campaign-level state.
-- ---------------------------------------------------------------------------

do $$ begin
  alter type public.unified_campaign_status add value if not exists 'LIVE';
exception when duplicate_object then null; end $$;
