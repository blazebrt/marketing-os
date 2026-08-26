create or replace function public.rpc_approve_campaign(p_campaign_id uuid, p_owner_id uuid)
returns json language plpgsql security invoker as $$
declare
    v_uid uuid;
    v_owner_id uuid;
    v_campaign record;
    v_provider text;
    v_requested_providers text[];
    v_deployed_providers text[];
    v_missing_integrations int;
    
    v_calc_daily numeric(15, 2);
    v_calc_total numeric(15, 2);
begin
    -- 1. Security & Identity
    v_uid := auth.uid();
    
    if v_uid is null then
        raise exception 'Unauthorized: No authenticated user';
    end if;
    
    if v_uid != p_owner_id then
        raise exception 'Unauthorized: Caller UID does not match requested owner_id';
    end if;
    
    v_owner_id := v_uid;

    -- 2. Lock Campaign
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

    -- 3. Strict Prelaunch Transactional Validation (TOCTOU protection)
    
    -- Budget & Duration Safety Validation
    if v_campaign.budget_amount <= 0 then
        raise exception 'Negative or zero budget';
    end if;
    
    if v_campaign.duration_days <= 0 then
        raise exception 'Invalid duration';
    end if;
    
    if v_campaign.budget_type not in ('daily', 'total') then
        raise exception 'Invalid budget type';
    end if;
    
    -- Calculate expected limits
    if v_campaign.budget_type = 'daily' then
        v_calc_daily := v_campaign.budget_amount;
        v_calc_total := v_campaign.budget_amount * v_campaign.duration_days;
    else
        v_calc_total := v_campaign.budget_amount;
        v_calc_daily := v_campaign.budget_amount / v_campaign.duration_days;
    end if;
    
    -- Enforce absolute system safety ceilings
    if v_calc_daily > 50000 then
        raise exception 'Daily spend exceeds safety limit';
    end if;
    if v_calc_total > 500000 then
        raise exception 'Total spend exceeds safety limit';
    end if;
    
    -- Reject inconsistent/tampered stored limits
    if v_campaign.max_daily_spend != v_calc_daily then
        raise exception 'Tampered max_daily_spend';
    end if;
    if v_campaign.max_campaign_spend != v_calc_total then
        raise exception 'Tampered max_campaign_spend';
    end if;
    if coalesce(v_campaign.max_auto_budget_increase, 0) != 0 then
        raise exception 'Tampered max_auto_budget_increase';
    end if;

    -- Creative and Destination Validation
    if v_campaign.creative_id is null then
        raise exception 'Creative must be assigned';
    end if;
    -- Note: creative_id references public.creatives which uses uuid, but schema could use text. 
    -- Assuming UUID cast for strictness since we are validating ownership:
    if not exists (select 1 from public.creatives where id = v_campaign.creative_id::uuid and owner_id = v_owner_id) then
        raise exception 'Creative not found or unauthorized';
    end if;
    if coalesce(v_campaign.destination, '') = '' then
        raise exception 'Destination must be set';
    end if;

    -- Normalize requested providers and check integrations
    if array_length(v_campaign.channels, 1) is null or array_length(v_campaign.channels, 1) = 0 then
        raise exception 'No channels selected';
    end if;

    select array_agg(lower(c) order by lower(c)) into v_requested_providers
    from unnest(v_campaign.channels) as c;

    select count(*) into v_missing_integrations
    from unnest(v_requested_providers) as p
    where not exists (
        select 1 from public.integrations
        where owner_id = v_owner_id and lower(provider) = p and status = 'connected'
    );

    if v_missing_integrations > 0 then
        raise exception 'Missing connected integration for one or more selected channels';
    end if;

    if lower(v_campaign.destination) like '%website%' then
        if not exists (select 1 from public.integrations where owner_id = v_owner_id and lower(provider) = 'website' and status = 'connected') then
            raise exception 'Website destination requires connected website tracking integration';
        end if;
    end if;

    -- 4. Transition to APPROVED (Logic)
    update public.unified_campaigns
    set status = 'APPROVED', updated_at = now()
    where id = p_campaign_id;

    -- 5. Idempotently create deployments
    foreach v_provider in array v_requested_providers loop
        insert into public.channel_deployments (campaign_id, owner_id, provider, status)
        values (p_campaign_id, v_owner_id, v_provider, 'PENDING')
        on conflict (campaign_id, provider) do nothing;
    end loop;

    -- 6. Verify deployments EXACT SET match
    select array_agg(lower(provider) order by lower(provider)) into v_deployed_providers
    from public.channel_deployments
    where campaign_id = p_campaign_id and owner_id = v_owner_id;

    if v_deployed_providers is distinct from v_requested_providers then
        raise exception 'Exact deployment mapping mismatch';
    end if;

    -- 7. Final Transition to READY_TO_DEPLOY
    update public.unified_campaigns
    set status = 'READY_TO_DEPLOY', updated_at = now()
    where id = p_campaign_id;

    -- 8. Transactional Audit Log
    insert into public.audit_logs (owner_id, action, resource_type, resource_id, details)
    values
    (v_owner_id, 'CAMPAIGN_APPROVED', 'campaign', p_campaign_id, '{"reason": "Campaign explicitly approved by owner"}'),
    (v_owner_id, 'CAMPAIGN_STATE_CHANGED', 'campaign', p_campaign_id, '{"transition": "APPROVED -> READY_TO_DEPLOY"}');

    return json_build_object('success', true);
end;
$$;
