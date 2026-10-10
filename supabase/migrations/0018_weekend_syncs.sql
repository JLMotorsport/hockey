-- 0018: fixed safety-net syncs at Saturday 20:00 and Sunday 17:00, UK time.
--
-- The after-game sync (0017) tries each game once, at kick-off + 3h25. These
-- two catch results posted later. pg_cron runs in UTC, so the job runs at
-- the top of every weekend hour and the database checks the UK time itself:
-- right through the clock changes.
--
-- Safe to run again. Uses the eh_sync_url / eh_sync_secret Vault values from 0017.

-- One place that sends a sync request to eh-sync.
create or replace function public.call_eh_sync()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'eh_sync_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'eh_sync_secret';
  if v_url is null or v_secret is null then
    raise notice 'eh_sync_url / eh_sync_secret are not in the Vault yet: no sync.';
    return false;
  end if;
  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 150000
  );
  return true;
end;
$$;
revoke execute on function public.call_eh_sync() from public, anon, authenticated;

-- The after-game sync, now using call_eh_sync(). Same behaviour as in 0017.
create or replace function public.run_due_sync()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids int[] := array(select public.fixtures_due_for_sync());
begin
  if cardinality(v_ids) = 0 or not public.call_eh_sync() then
    return 0;
  end if;
  update public.fixtures set auto_synced_at = now() where id = any (v_ids);
  return cardinality(v_ids);
end;
$$;
revoke execute on function public.run_due_sync() from public, anon, authenticated;

-- Is it Saturday 20:00 or Sunday 17:00 in the UK (within the hour's first 10 minutes)?
create or replace function public.weekend_sync_due(p_now timestamptz default now())
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (extract(isodow from l) = 6 and extract(hour from l) = 20
          or extract(isodow from l) = 7 and extract(hour from l) = 17)
     and extract(minute from l) < 10
  from (select p_now at time zone 'Europe/London' as l) t
$$;

create or replace function public.run_weekend_sync()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.weekend_sync_due() and public.call_eh_sync();
end;
$$;
revoke execute on function public.run_weekend_sync() from public, anon, authenticated;

-- Top of every hour on Saturdays and Sundays (UTC); the function decides.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ff-sync-weekend') then
    perform cron.unschedule('ff-sync-weekend');
  end if;
  perform cron.schedule('ff-sync-weekend', '0 * * * 6,0', 'select public.run_weekend_sync()');
end;
$$;
