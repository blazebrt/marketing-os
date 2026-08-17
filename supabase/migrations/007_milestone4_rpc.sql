-- Clarify creative architecture
-- public.creatives is the single authoritative shared registry.
create table if not exists public.creatives_meta (
    id uuid primary key default gen_random_uuid(),
    creative_id uuid not null references public.creatives(id) on delete cascade,
    owner_id uuid not null,
    meta_image_hash text,
    created_at timestamptz not null default now()
);

create table if not exists public.creatives_google (
    id uuid primary key default gen_random_uuid(),
    creative_id uuid not null references public.creatives(id) on delete cascade,
    owner_id uuid not null,
    google_asset_id text,
    created_at timestamptz not null default now()
);

alter table public.creatives_meta enable row level security;
create policy "owner_creatives_meta" on public.creatives_meta for all using (auth.uid() = owner_id);

alter table public.creatives_google enable row level security;
create policy "owner_creatives_google" on public.creatives_google for all using (auth.uid() = owner_id);

-- Explicit RPC for atomic, idempotent fail-closed state transitions
create or replace function public.rpc_approve_campaign(p_campaign_id uuid, p_owner_id uuid)
returns json language plpgsql security invoker as $$
declare
    v_campaign record;
    v_provider text;
    v_deployment_count int;
begin
    -- 1. Lock and Verify Status
    select * into v_campaign
    from public.unified_campaigns
    where id = p_campaign_id and owner_id = p_owner_id
    for update;

    if not found then
        raise exception 'Campaign not found or unauthorized';
    end if;

    if v_campaign.status != 'PENDING_APPROVAL' then
        raise exception 'Campaign must be in PENDING_APPROVAL state';
    end if;

    -- 2. Transition to APPROVED
    update public.unified_campaigns
    set status = 'APPROVED', updated_at = now()
    where id = p_campaign_id;

    -- 3. Idempotently create deployments
    if array_length(v_campaign.channels, 1) is not null then
        foreach v_provider in array v_campaign.channels loop
            insert into public.channel_deployments (campaign_id, owner_id, provider, status)
            values (p_campaign_id, p_owner_id, lower(v_provider), 'PENDING')
            on conflict (campaign_id, provider) do nothing;
        end loop;
    end if;

    -- 4. Verify deployments exist for every channel and belong to same owner
    select count(*) into v_deployment_count
    from public.channel_deployments
    where campaign_id = p_campaign_id and owner_id = p_owner_id;

    if v_deployment_count != coalesce(array_length(v_campaign.channels, 1), 0) then
        raise exception 'Partial or invalid deployment mapping detected';
    end if;

    -- 5. Final Transition to READY_TO_DEPLOY
    update public.unified_campaigns
    set status = 'READY_TO_DEPLOY', updated_at = now()
    where id = p_campaign_id;

    return json_build_object('success', true);
end;
$$;
