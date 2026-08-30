-- Atomic failed-login counter. Call only with the service role.
-- Parallel guesses must not each read count=7 and all succeed.

create or replace function public.rpc_record_login_failure(p_email_hash text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window interval := interval '15 minutes';
  v_lock interval := interval '15 minutes';
  v_max int := 8;
begin
  if p_email_hash is null or length(p_email_hash) <> 64 or p_email_hash !~ '^[0-9a-f]+$' then
    return;
  end if;

  insert into public.login_throttle
    (email_hash, attempt_count, window_started_at, locked_until, updated_at)
  values (p_email_hash, 1, v_now, null, v_now)
  on conflict (email_hash) do update
  set
    attempt_count = case
      when login_throttle.locked_until is not null and login_throttle.locked_until > v_now
        then login_throttle.attempt_count
      when login_throttle.window_started_at > v_now - v_window
        then login_throttle.attempt_count + 1
      else 1
    end,
    window_started_at = case
      when login_throttle.locked_until is not null and login_throttle.locked_until > v_now
        then login_throttle.window_started_at
      when login_throttle.window_started_at > v_now - v_window
        then login_throttle.window_started_at
      else v_now
    end,
    locked_until = case
      when login_throttle.locked_until is not null and login_throttle.locked_until > v_now
        then login_throttle.locked_until
      when (
        case
          when login_throttle.window_started_at > v_now - v_window
            then login_throttle.attempt_count + 1
          else 1
        end
      ) >= v_max then v_now + v_lock
      else null
    end,
    updated_at = v_now;
end;
$$;

revoke all on function public.rpc_record_login_failure(text) from public;
do $$ begin
  revoke all on function public.rpc_record_login_failure(text) from anon, authenticated;
exception when undefined_object then null;
end $$;
do $$ begin
  grant execute on function public.rpc_record_login_failure(text) to service_role;
exception when undefined_object then null;
end $$;
