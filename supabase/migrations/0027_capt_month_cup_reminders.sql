-- Capt %, Manager of the Month, the Cup, and phone reminders.
--
-- * player_market() also gives the share of managers captaining each player
--   for the next gameweek (totals only, as Sel %).
-- * league_points(): each manager's points per gameweek (after transfer
--   hits), for the Month table and the Cup.
-- * The Cup starts at gameweek number cup_start (9); cup_entrants() is who
--   had a squad for it.
-- * Phone reminders: each device's push subscription, a "only if I haven't
--   saved" setting, and an hourly job that calls the reminders function,
--   which sends the evening-before and hour-before notifications.
--
-- Safe to re-run.

-- --- Capt % ----------------------------------------------------------------

drop function if exists public.player_market();
create or replace function public.player_market()
returns table (player_id int, selected_by numeric, captained_by numeric, transfers_in int, transfers_out int)
language sql
stable
security definer
set search_path = ''
as $$
  with nxt as (
    select id, start_date from public.gameweeks where deadline > now() order by start_date limit 1
  ),
  prv as (
    select g.id from public.gameweeks g, nxt
    where g.start_date < nxt.start_date order by g.start_date desc limit 1
  ),
  mgr as (
    select pr.id as user_id,
      public.squad_source_gameweek(pr.id, (select id from nxt)) as cur_src,
      public.squad_source_gameweek(pr.id, (select id from prv)) as prev_src
    from public.profiles pr
  ),
  cur as (
    select m.user_id, p.player_id, p.is_captain
    from mgr m join public.picks p on p.user_id = m.user_id and p.gameweek_id = m.cur_src
  ),
  prev as (
    select m.user_id, p.player_id
    from mgr m join public.picks p on p.user_id = m.user_id and p.gameweek_id = m.prev_src
    where m.cur_src is distinct from m.prev_src
  ),
  managers as (select count(distinct user_id) as n from cur),
  owned as (
    select c.player_id, count(*) as n, count(*) filter (where c.is_captain) as capt
    from cur c group by c.player_id
  ),
  ins as (
    select c.player_id, count(*) as n
    from cur c
    where exists (select 1 from prev v where v.user_id = c.user_id)
      and not exists (select 1 from prev v where v.user_id = c.user_id and v.player_id = c.player_id)
    group by c.player_id
  ),
  outs as (
    select v.player_id, count(*) as n
    from prev v
    where not exists (select 1 from cur c where c.user_id = v.user_id and c.player_id = v.player_id)
    group by v.player_id
  )
  select pl.id,
    case when managers.n > 0 then round(100.0 * coalesce(owned.n, 0) / managers.n, 1) else 0 end,
    case when managers.n > 0 then round(100.0 * coalesce(owned.capt, 0) / managers.n, 1) else 0 end,
    coalesce(ins.n, 0)::int,
    coalesce(outs.n, 0)::int
  from public.players pl
  cross join managers
  left join owned on owned.player_id = pl.id
  left join ins on ins.player_id = pl.id
  left join outs on outs.player_id = pl.id;
$$;
revoke execute on function public.player_market() from public;
grant execute on function public.player_market() to anon, authenticated;

-- --- Points per gameweek (Month, Cup) ----------------------------------------

-- Each manager's points for each counted gameweek, transfer hits taken off:
-- the league table's own figures (it rebuilds them first if stale).
create or replace function public.league_points()
returns table (user_id uuid, gameweek_id int, points int)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.league_table();
  return query select c.user_id, c.gameweek_id, c.points from public.league_cache c;
end;
$$;
revoke execute on function public.league_points() from public;
grant execute on function public.league_points() to anon, authenticated;

-- --- The Cup ------------------------------------------------------------------

alter table public.league_settings add column if not exists cup_start int not null default 9;

-- Who is in the Cup: everyone who had a squad for its first gameweek.
create or replace function public.cup_entrants(p_gameweek int)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pr.id from public.profiles pr
  where public.squad_source_gameweek(pr.id, p_gameweek) is not null;
$$;
revoke execute on function public.cup_entrants(int) from public;
grant execute on function public.cup_entrants(int) to anon, authenticated;

-- --- Phone reminders -------------------------------------------------------------

alter table public.profiles add column if not exists remind_only_unsaved boolean not null default false;
grant update (remind_only_unsaved) on public.profiles to authenticated;

-- One row per phone (browser) that has said yes to notifications.
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- The keys the reminders function signs notifications with. It makes them on
-- first use; only the public half is ever handed out.
create table if not exists public.vapid_keys (
  id int primary key default 1 check (id = 1),
  public_key text not null,
  private_key text not null
);
alter table public.vapid_keys enable row level security;
revoke all on public.vapid_keys from anon, authenticated;

create or replace function public.vapid_public_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public_key from public.vapid_keys where id = 1;
$$;
revoke execute on function public.vapid_public_key() from public;
grant execute on function public.vapid_public_key() to anon, authenticated;

-- Each reminder goes once: (gameweek, 'eve' or 'soon').
create table if not exists public.reminder_log (
  gameweek_id int not null references public.gameweeks (id) on delete cascade,
  kind text not null check (kind in ('eve', 'soon')),
  sent_at timestamptz not null default now(),
  primary key (gameweek_id, kind)
);
alter table public.reminder_log enable row level security;
revoke all on public.reminder_log from anon, authenticated;

-- Who to remind for a gameweek, and what to say: free transfers left, and
-- starters whose side has no game. Skips people who asked to hear only while
-- they haven't saved, once they have.
create or replace function public.reminder_targets(p_gameweek int)
returns table (
  user_id uuid, endpoint text, p256dh text, auth text,
  has_squad boolean, free int, no_game text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id, s.endpoint, s.p256dh, s.auth,
    public.squad_source_gameweek(s.user_id, p_gameweek) is not null,
    greatest(0, public.free_transfers(s.user_id, p_gameweek) - public.transfers_used(s.user_id, p_gameweek)),
    array(
      select pl.name from public.picks k
      join public.players pl on pl.id = k.player_id
      where k.user_id = s.user_id
        and k.gameweek_id = public.squad_source_gameweek(s.user_id, p_gameweek)
        and k.bench_order is null
        and not exists (
          select 1 from public.fixtures f where f.side_id = pl.side_id and f.gameweek_id = p_gameweek
        )
      order by pl.name
    )
  from public.push_subscriptions s
  join public.profiles p on p.id = s.user_id
  where not (
    p.remind_only_unsaved
    and exists (select 1 from public.picks k where k.user_id = s.user_id and k.gameweek_id = p_gameweek)
  );
$$;
revoke execute on function public.reminder_targets(int) from public, anon, authenticated;
grant execute on function public.reminder_targets(int) to service_role;

-- Calls the reminders function (same project and secret as eh-sync, 0017).
create or replace function public.call_reminders()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select replace(decrypted_secret, '/eh-sync', '/reminders') into v_url
  from vault.decrypted_secrets where name = 'eh_sync_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'eh_sync_secret';
  if v_url is null or v_secret is null then
    raise notice 'eh_sync_url / eh_sync_secret are not in the Vault yet: no reminders.';
    return false;
  end if;
  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    timeout_milliseconds := 60000
  );
  return true;
end;
$$;
revoke execute on function public.call_reminders() from public, anon, authenticated;

-- Five past every hour; the function decides whether a reminder is due.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'ff-reminders') then
      perform cron.unschedule('ff-reminders');
    end if;
    perform cron.schedule('ff-reminders', '5 * * * *', 'select public.call_reminders()');
  end if;
end;
$$;
