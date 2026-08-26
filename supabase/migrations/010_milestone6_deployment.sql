-- 010_milestone6_deployment.sql

-- Add new states to channel_deployment_status if they don't exist
do $$ begin
  alter type channel_deployment_status add value 'READY_TO_DEPLOY';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type channel_deployment_status add value 'DEPLOYMENT_LOCKED';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type channel_deployment_status add value 'CREATING_CAMPAIGN';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type channel_deployment_status add value 'CREATING_AD_GROUP';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type channel_deployment_status add value 'CREATING_ADS';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type channel_deployment_status add value 'CREATING_KEYWORDS';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type channel_deployment_status add value 'VERIFYING';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type channel_deployment_status add value 'ACTIVE';
exception when duplicate_object then null; end $$;

-- Add new tracking columns to channel_deployments
alter table public.channel_deployments
add column if not exists external_state jsonb not null default '{}'::jsonb,
add column if not exists failure_code text,
add column if not exists failure_stage text,
add column if not exists locked_at timestamptz,
add column if not exists locked_by text;
