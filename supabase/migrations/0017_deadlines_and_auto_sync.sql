-- 0017: deadlines an hour before the first game, and a sync after each game.
--
-- Safe to run again: everything is create or replace / if not exists.
--
-- After running this, the after-game sync needs two values in the Vault (run
-- once in the SQL editor, with your own secret):
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/eh-sync', 'eh_sync_url');
--   select vault.create_secret('<the EH_SYNC_SECRET the eh-sync function has>', 'eh_sync_secret');
-- Until they're there the job runs but does nothing.

-- ---------------------------------------------------------------------------
-- 1. Deadline: one hour before the gameweek's first game, every week
-- ---------------------------------------------------------------------------
-- Saturday 10:00 is only the fallback while no kick-off time is known. A
-- deadline a manager set stays, unless a game means it must come earlier.

create or replace function public.refresh_deadline(p_gameweek_id int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gw public.gameweeks;
  v_first timestamptz;
  v_new timestamptz;
begin
  select * into v_gw from public.gameweeks where id = p_gameweek_id for update;
  if not found or v_gw.deadline <= now() then
    return; -- gone, or already locked: never move a deadline that has passed
  end if;
  select min(f.kickoff) into v_first
  from public.fixtures f
  where f.gameweek_id = p_gameweek_id
    -- A game at 00:00 has no time set yet.
    and (f.kickoff at time zone 'Europe/London')::time <> time '00:00';
  v_new := coalesce(
    v_first - interval '1 hour',
    (v_gw.start_date + time '10:00') at time zone 'Europe/London'
  );
  if v_gw.deadline_manual then
    v_new := least(v_gw.deadline, v_new);
  end if;
  -- A game found late (already started) locks the gameweek now.
  v_new := greatest(v_new, now());
  if v_new is distinct from v_gw.deadline then
    update public.gameweeks set deadline = v_new where id = p_gameweek_id;
  end if;
end;
$$;
revoke execute on function public.refresh_deadline(int) from public, anon, authenticated;

-- Put every gameweek still open on the new rule now.
select public.refresh_deadline(id) from public.gameweeks where deadline > now();

-- ---------------------------------------------------------------------------
-- 2. Sync from England Hockey two hours after each game should have finished
-- ---------------------------------------------------------------------------
-- A game is 70 minutes plus 15 for half time, so the sync is due at
-- kick-off + 85 minutes + 2 hours = kick-off + 3h25. A job every 10 minutes
-- looks for games that have reached that point and calls eh-sync once for
-- all of them. The Sunday and Monday evening sync, if scheduled, still runs
-- as a safety net for results posted late.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

alter table public.fixtures add column if not exists auto_synced_at timestamptz;

-- A game moved to a new time gets synced again after it.
create or replace function public.fixtures_reset_auto_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kickoff is distinct from old.kickoff then
    new.auto_synced_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists fixtures_reset_auto_sync on public.fixtures;
create trigger fixtures_reset_auto_sync
  before update of kickoff on public.fixtures
  for each row execute function public.fixtures_reset_auto_sync();

-- Games whose sync is due: finished two hours ago (within the last two days,
-- so a new season doesn't trigger syncs for old games), time known, not yet synced.
create or replace function public.fixtures_due_for_sync(p_now timestamptz default now())
returns setof int
language sql
stable
security definer
set search_path = ''
as $$
  select f.id
  from public.fixtures f
  where f.auto_synced_at is null
    and (f.kickoff at time zone 'Europe/London')::time <> time '00:00'
    and f.kickoff + interval '3 hours 25 minutes' <= p_now
    and f.kickoff + interval '3 hours 25 minutes' > p_now - interval '2 days'
  order by f.kickoff
$$;
revoke execute on function public.fixtures_due_for_sync(timestamptz) from public, anon, authenticated;

create or replace function public.run_due_sync()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids int[] := array(select public.fixtures_due_for_sync());
  v_url text;
  v_secret text;
begin
  if cardinality(v_ids) = 0 then
    return 0;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'eh_sync_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'eh_sync_secret';
  if v_url is null or v_secret is null then
    raise notice 'eh_sync_url / eh_sync_secret are not in the Vault yet: no sync.';
    return 0;
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
  update public.fixtures set auto_synced_at = now() where id = any (v_ids);
  return cardinality(v_ids);
end;
$$;
revoke execute on function public.run_due_sync() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'ff-sync-after-games') then
    perform cron.unschedule('ff-sync-after-games');
  end if;
  perform cron.schedule('ff-sync-after-games', '*/10 * * * *', 'select public.run_due_sync()');
end;
$$;
