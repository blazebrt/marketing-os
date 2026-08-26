-- 0002_functions.sql
-- RPC functions called by the application.
--
-- rpc_approve_campaign is the milestone-7 version (the final one in the old
-- 007 -> 008 -> 011 chain). The earlier two are superseded and are not
-- recreated here.
--
-- All functions are `security invoker`, so row-level security still applies to
-- the calling user. Do not change them to `security definer`.

-- ---------------------------------------------------------------------------
-- Validates a jsonb array of creative items: correct count, every item
-- owner-approved, none rejected, and each value non-empty and within length.
-- ---------------------------------------------------------------------------

create or replace function public.m7_json_items_ready(
  items jsonb, min_count int, max_count int, max_len int
)
returns boolean language plpgsql as $fn$
declare
  elem jsonb;
  val text;
  cnt int;
begin
  if items is null or jsonb_typeof(items) <> 'array' then
    return false;
  end if;
  cnt := jsonb_array_length(items);
  if cnt < min_count or cnt > max_count then
    return false;
  end if;
  for elem in select value from jsonb_array_elements(items) as t(value) loop
    if coalesce(elem->>'rejected', 'false') in ('true', 't') then
      return false;
    end if;
    if coalesce(elem->>'owner_approved', '') not in ('true', 't') then
      return false;
    end if;
    val := elem->>'current_value';
    if val is null or length(trim(val)) = 0 then
      return false;
    end if;
    if length(val) > max_len then
      return false;
    end if;
  end loop;
  return true;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Takes the generation lock for a campaign's creative, enforcing per-owner and
-- per-campaign rate limits and refusing to overwrite approved content.
-- ---------------------------------------------------------------------------

create or replace function public.rpc_acquire_generation_lock(p_campaign_id uuid)
returns json language plpgsql security invoker as $fn$
declare
  v_uid uuid;
  v_campaign record;
  v_creative record;
  v_google record;
  v_hour int;
  v_last_user timestamptz;
  v_last_camp timestamptz;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select * into v_campaign
  from public.unified_campaigns
  where id = p_campaign_id and owner_id = v_uid
  for update;

  if not found then
    raise exception 'UNAUTHORIZED';
  end if;

  select count(*) into v_hour
  from public.generation_rate_events
  where owner_id = v_uid and created_at > now() - interval '1 hour';
  if v_hour >= 30 then
    raise exception 'RATE_LIMITED';
  end if;

  select max(created_at) into v_last_user
  from public.generation_rate_events
  where owner_id = v_uid;
  if v_last_user is not null and v_last_user > now() - interval '10 seconds' then
    raise exception 'RATE_LIMITED';
  end if;

  select max(created_at) into v_last_camp
  from public.generation_rate_events
  where campaign_id = p_campaign_id;
  if v_last_camp is not null and v_last_camp > now() - interval '10 seconds' then
    raise exception 'RATE_LIMITED';
  end if;

  select * into v_creative
  from public.creatives
  where campaign_id = p_campaign_id and owner_id = v_uid
  for update;

  if found then
    if v_creative.status = 'APPROVED' then
      raise exception 'CREATIVE_LOCKED';
    end if;
    if v_creative.status = 'GENERATING'
       and v_creative.generation_lock_until is not null
       and v_creative.generation_lock_until > now() then
      raise exception 'RATE_LIMITED';
    end if;

    select * into v_google from public.creatives_google where creative_id = v_creative.id;
    if found then
      if exists (
        select 1 from jsonb_array_elements(coalesce(v_google.headlines, '[]'::jsonb)) e
        where coalesce(e->>'owner_approved', '') in ('true', 't')
      ) or exists (
        select 1 from jsonb_array_elements(coalesce(v_google.descriptions, '[]'::jsonb)) e
        where coalesce(e->>'owner_approved', '') in ('true', 't')
      ) or exists (
        select 1 from jsonb_array_elements(coalesce(v_google.keywords, '[]'::jsonb)) e
        where coalesce(e->>'owner_approved', '') in ('true', 't')
      ) then
        raise exception 'CREATIVE_LOCKED';
      end if;
    end if;

    update public.creatives
      set status = 'GENERATING',
          generation_lock_until = now() + interval '30 seconds',
          version = v_creative.version
      where id = v_creative.id;
  end if;

  insert into public.generation_rate_events (owner_id, campaign_id)
  values (v_uid, p_campaign_id);

  return json_build_object('success', true, 'owner_id', v_uid, 'campaign_id', p_campaign_id);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Atomic, fail-closed campaign approval. Re-validates budget ceilings, creative
-- approval, destination and integrations inside the transaction (TOCTOU
-- protection), then moves the campaign to READY_TO_DEPLOY and writes the
-- deployment target state.
-- ---------------------------------------------------------------------------

create or replace function public.rpc_approve_campaign(p_campaign_id uuid, p_owner_id uuid)
returns json language plpgsql security invoker as $fn$
declare
    v_uid uuid;
    v_owner_id uuid;
    v_campaign record;
    v_creative record;
    v_google record;
    v_provider text;
    v_requested_providers text[];
    v_deployed_providers text[];
    v_missing_integrations int;
    v_calc_daily numeric(15, 2);
    v_calc_total numeric(15, 2);
    v_target jsonb;
    v_dest_type text;
    v_landing text;
    v_google_requested boolean := false;
begin
    v_uid := auth.uid();

    if v_uid is null then
        raise exception 'Unauthorized: No authenticated user';
    end if;

    if v_uid != p_owner_id then
        raise exception 'Unauthorized: Caller UID does not match requested owner_id';
    end if;

    v_owner_id := v_uid;

    select * into v_campaign
    from public.unified_campaigns
    where id = p_campaign_id and owner_id = v_owner_id
    for update;

    if not found then
        raise exception 'Campaign not found or unauthorized';
    end if;

    if v_campaign.status != 'PENDING_APPROVAL' then
        raise exception 'Campaign must be in PENDING_APPROVAL state';
    end if;

    if v_campaign.budget_amount <= 0 then
        raise exception 'Negative or zero budget';
    end if;

    if v_campaign.duration_days <= 0 then
        raise exception 'Invalid duration';
    end if;

    if v_campaign.budget_type not in ('daily', 'total') then
        raise exception 'Invalid budget type';
    end if;

    if v_campaign.budget_type = 'daily' then
        v_calc_daily := v_campaign.budget_amount;
        v_calc_total := v_campaign.budget_amount * v_campaign.duration_days;
    else
        v_calc_total := v_campaign.budget_amount;
        v_calc_daily := v_campaign.budget_amount / v_campaign.duration_days;
    end if;

    if v_calc_daily > 50000 then
        raise exception 'Daily spend exceeds safety limit';
    end if;
    if v_calc_total > 500000 then
        raise exception 'Total spend exceeds safety limit';
    end if;

    if v_campaign.max_daily_spend != v_calc_daily then
        raise exception 'Tampered max_daily_spend';
    end if;
    if v_campaign.max_campaign_spend != v_calc_total then
        raise exception 'Tampered max_campaign_spend';
    end if;
    if coalesce(v_campaign.max_auto_budget_increase, 0) != 0 then
        raise exception 'Tampered max_auto_budget_increase';
    end if;

    if array_length(v_campaign.channels, 1) is null or array_length(v_campaign.channels, 1) = 0 then
        raise exception 'No channels selected';
    end if;

    -- Authoritative channel set is the locked campaign row, never a client-supplied list.
    select array_agg(lower(c) order by lower(c)) into v_requested_providers
    from unnest(v_campaign.channels) as c;

    v_google_requested := 'google' = any(v_requested_providers);

    if v_campaign.creative_id is null then
        raise exception 'Creative must be assigned';
    end if;

    select * into v_creative
    from public.creatives
    where id = v_campaign.creative_id::uuid and owner_id = v_owner_id
    for update;

    if not found then
        raise exception 'Creative not found or unauthorized';
    end if;

    if v_creative.campaign_id is distinct from p_campaign_id then
        raise exception 'Creative does not belong to campaign';
    end if;

    v_dest_type := coalesce(v_campaign.destination_type, 'WEBSITE');
    v_landing := coalesce(nullif(v_campaign.landing_url, ''), v_campaign.destination);

    if v_google_requested then
        select * into v_google
        from public.creatives_google
        where creative_id = v_creative.id and owner_id = v_owner_id
        for update;

        if not found then
            raise exception 'Google creative content missing';
        end if;

        if not public.m7_json_items_ready(v_google.headlines, 3, 15, 30) then
            raise exception 'Invalid or unapproved headlines';
        end if;
        if not public.m7_json_items_ready(v_google.descriptions, 2, 4, 90) then
            raise exception 'Invalid or unapproved descriptions';
        end if;
        if not public.m7_json_items_ready(v_google.keywords, 1, 20, 80) then
            raise exception 'Invalid or unapproved keywords';
        end if;

        if v_dest_type is distinct from 'WEBSITE' then
            raise exception 'GOOGLE_DESTINATION_UNSUPPORTED';
        end if;

        if v_landing is null or v_landing not like 'https://%' then
            raise exception 'Destination must be a verified HTTPS landing URL';
        end if;
        if v_campaign.destination_verification_status is distinct from 'VALID' then
            raise exception 'Destination verification valid required';
        end if;
    else
        if coalesce(v_campaign.destination, '') = '' and v_landing is null then
            raise exception 'Destination must be set';
        end if;
    end if;

    select count(*) into v_missing_integrations
    from unnest(v_requested_providers) as p
    where not exists (
        select 1 from public.integrations
        where owner_id = v_owner_id and lower(provider) = p and status = 'connected'
    );

    if v_missing_integrations > 0 then
        raise exception 'Missing connected integration for one or more selected channels';
    end if;

    if lower(coalesce(v_campaign.destination, '')) like '%website%' or v_dest_type = 'WEBSITE' then
        if exists (select 1 from unnest(v_requested_providers) p where p = 'website') then
          if not exists (
            select 1 from public.integrations
            where owner_id = v_owner_id and lower(provider) = 'website' and status = 'connected'
          ) then
              raise exception 'Website destination requires connected website tracking integration';
          end if;
        end if;
    end if;

    update public.unified_campaigns
    set status = 'APPROVED', updated_at = now()
    where id = p_campaign_id;

    update public.creatives
    set status = 'APPROVED'
    where id = v_creative.id;

    if v_google_requested then
      v_target := jsonb_build_object(
        'schemaVersion', 'v1',
        'provider', 'google',
        'campaign', jsonb_build_object(
          'id', v_campaign.id,
          'budget', v_campaign.budget_amount,
          'duration', v_campaign.duration_days,
          'destination', v_landing
        ),
        'bidding', jsonb_build_object(
          'strategy', 'MANUAL_CPC',
          'confidence', 1,
          'reasons', jsonb_build_array('Approval snapshot uses conservative MANUAL_CPC'),
          'safetyConstraints', jsonb_build_array('max_auto_budget_increase=0')
        ),
        'adGroup', jsonb_build_object(
          'name', coalesce(v_campaign.service, 'Campaign') || ' - Google',
          'type', 'SEARCH_STANDARD'
        ),
        'keywords', v_google.keywords,
        'headlines', v_google.headlines,
        'descriptions', v_google.descriptions,
        'destination', jsonb_build_object('url', v_landing, 'tracking', 'utm_source=google&utm_medium=cpc'),
        'generatedAt', to_jsonb(now())
      );
    end if;

    foreach v_provider in array v_requested_providers loop
        if v_google_requested and v_provider = 'google' then
          insert into public.channel_deployments (campaign_id, owner_id, provider, status, target_state)
          values (p_campaign_id, v_owner_id, v_provider, 'READY_TO_DEPLOY', v_target)
          on conflict (campaign_id, provider) do update
            set status = 'READY_TO_DEPLOY',
                target_state = excluded.target_state,
                updated_at = now()
            where public.channel_deployments.status = 'PENDING';
        else
          insert into public.channel_deployments (campaign_id, owner_id, provider, status)
          values (p_campaign_id, v_owner_id, v_provider, 'PENDING')
          on conflict (campaign_id, provider) do nothing;
        end if;
    end loop;

    select array_agg(lower(provider) order by lower(provider)) into v_deployed_providers
    from public.channel_deployments
    where campaign_id = p_campaign_id and owner_id = v_owner_id;

    if v_deployed_providers is distinct from v_requested_providers then
        raise exception 'Exact deployment mapping mismatch';
    end if;

    if v_google_requested then
      if not exists (
        select 1 from public.channel_deployments
        where campaign_id = p_campaign_id and provider = 'google'
          and status = 'READY_TO_DEPLOY'
          and target_state ? 'headlines'
          and jsonb_typeof(target_state->'headlines') = 'array'
          and jsonb_array_length(target_state->'headlines') >= 3
      ) then
        raise exception 'READY_TO_DEPLOY requires complete target_state';
      end if;
    end if;

    update public.unified_campaigns
    set status = 'READY_TO_DEPLOY', updated_at = now()
    where id = p_campaign_id;

    insert into public.audit_logs (owner_id, action, resource_type, resource_id, details)
    values
    (v_owner_id, 'CAMPAIGN_APPROVED', 'campaign', p_campaign_id,
      '{"reason": "Campaign explicitly approved by owner"}'::jsonb),
    (v_owner_id, 'CAMPAIGN_STATE_CHANGED', 'campaign', p_campaign_id,
      '{"transition": "APPROVED -> READY_TO_DEPLOY"}'::jsonb);

    return json_build_object('success', true);
end;
$fn$;
