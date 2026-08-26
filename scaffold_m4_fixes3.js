const fs = require('fs');
const path = require('path');

const write = (p, content) => {
  const full = path.join(process.cwd(), p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.trim() + '\n', 'utf-8');
};

write('supabase/migrations/008_milestone4_rpc_v2.sql', `
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
begin
    -- 1. Security & Identity
    v_uid := auth.uid();
    if v_uid is not null and v_uid != p_owner_id then
        raise exception 'Unauthorized: caller UID does not match requested owner_id';
    end if;
    v_owner_id := coalesce(v_uid, p_owner_id);

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
    if v_campaign.budget_amount <= 0 then
        raise exception 'Budget must be greater than zero';
    end if;
    if v_campaign.duration_days <= 0 then
        raise exception 'Duration must be greater than zero';
    end if;
    if v_campaign.creative_id is null then
        raise exception 'Creative must be assigned';
    end if;
    if not exists (select 1 from public.creatives where id = v_campaign.creative_id and owner_id = v_owner_id) then
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
`);

let actions = fs.readFileSync('src/app/campaigns/actions.ts', 'utf8');

// replace approveCampaign inside actions.ts to completely defer to RPC
const newApprove = `
export async function approveCampaign(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // Verify campaign logic is now handled 100% inside the transaction.
  const { data, error } = await supabase.rpc('rpc_approve_campaign', {
    p_campaign_id: campaignId,
    p_owner_id: user.id
  });

  if (error || !data?.success) {
    throw new Error(error?.message || 'Deployment mapping or state transition failed transactionally.');
  }

  revalidatePath('/campaigns');
  revalidatePath(\`/campaigns/\${campaignId}\`);
  return true;
}
`;

actions = actions.replace(/export async function approveCampaign[\s\S]*$/, newApprove);
fs.writeFileSync('src/app/campaigns/actions.ts', actions);
console.log('Done scaffold');
