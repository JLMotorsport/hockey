-- Fixes from the code review of 18 Oct.
--
-- * On a walkover, only player of the match counts as having played: a
--   player merely listed on one doesn't block auto-subs or keep the captain's
--   double from the vice (squad_lineup), and isn't a game for their side.
-- * A walkover clears its stats only when first marked, not when England
--   Hockey later corrects which way it went (a manager's player of the match
--   is kept).
-- * The Cup draw is frozen at the Cup's first deadline (cup_seeds, cup_draw):
--   accounts deleted or added later don't rewrite rounds already played.
-- * save_push_subscription: a phone moves to whoever turns reminders on last
--   (a shared phone), instead of failing on the unique endpoint.
-- * One-off steps record that they ran, so pasting 0032 again doesn't move
--   players back a second time.
-- * Only the super user can switch fixture difficulty on or off.
-- * Capt % shows the live gameweek's captains, never next week's before the
--   deadline.
--
-- Safe to re-run.

-- --- Walkovers ----------------------------------------------------------------

-- As 0034, with "played" not counting someone merely listed on a walkover.
create or replace function public.squad_lineup(p_user uuid, p_gameweek int)
returns table (player_id int, is_captain boolean, is_vice boolean, bench_order smallint, points int, played boolean, counts boolean, sub text, doubled boolean, bus_points int)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_gw public.gameweeks;
  v_formations text[];
  v_settled boolean;
  r record;
  b record;
  v_counts int[];
  v_used int[] := '{}';
  v_shape text;
  v_doubled int;
  v_chip public.chips_played;
  v_multiplier int := 2;
begin
  select * into v_gw from public.gameweeks where id = p_gameweek;
  select formations into v_formations from public.league_settings where id = 1;
  v_settled := v_gw.deadline <= now() and v_gw.start_date + 2 <= (now() at time zone 'Europe/London')::date;
  select * into v_chip from public.chips_played c where c.user_id = p_user and c.gameweek_id = p_gameweek;
  if v_chip.chip = 'triple_captain' then
    v_multiplier := 3;
  end if;

  create temp table if not exists _lineup (
    player_id int, is_captain boolean, is_vice boolean, bench_order smallint, position text, points int,
    played boolean, counts boolean, sub text, bus_points int
  ) on commit drop;
  delete from _lineup where true; -- (safeupdate needs a where)
  insert into _lineup
  select
    p.player_id, p.is_captain, p.is_vice, p.bench_order, pl.position,
    coalesce(pgp.points, 0),
    -- Played: a real game, or player of the match on a walkover. Someone
    -- merely listed on a walkover didn't play (auto-subs and the vice
    -- captain's double treat them as not playing).
    exists (
      select 1 from public.performances pf2 join public.fixtures f2 on f2.id = pf2.fixture_id
      where pf2.player_id = p.player_id and f2.gameweek_id = p_gameweek
        and (f2.walkover is null or pf2.player_of_match)
    ),
    -- Rolling Subs: all 15 count.
    p.bench_order is null or v_chip.chip is not distinct from 'rolling_subs',
    null,
    -- Team Bus: points earned playing for the chosen side this gameweek.
    case when v_chip.chip = 'team_bus' then (
      select coalesce(sum(public.performance_points(
        pl.position, pf.goals, pf.assists, pf.green_cards, pf.yellow_cards, pf.red_cards,
        pf.player_of_match, f.goals_for, f.goals_against, f.is_home, f.walkover is not null
      )), 0)::int
      from public.performances pf join public.fixtures f on f.id = pf.fixture_id
      where pf.player_id = p.player_id and f.gameweek_id = p_gameweek and f.side_id = v_chip.side_id
    ) else 0 end
  from public.picks p
  join public.players pl on pl.id = p.player_id
  left join public.player_gameweek_points pgp on pgp.player_id = p.player_id and pgp.gameweek_id = p_gameweek
  where p.user_id = p_user and p.gameweek_id = public.squad_source_gameweek(p_user, p_gameweek);

  if v_settled and v_chip.chip is distinct from 'rolling_subs'
     and exists (select 1 from _lineup where _lineup.bench_order is not null) then
    -- Keeper first.
    if exists (select 1 from _lineup l where l.counts and l.position = 'GK' and not l.played)
       and exists (select 1 from _lineup l where l.bench_order = 1 and l.played) then
      update _lineup l set counts = false, sub = 'off' where l.counts and l.position = 'GK';
      update _lineup l set counts = true, sub = 'on' where l.bench_order = 1;
    end if;
    -- Outfield, starters in position order, subs in bench order.
    for r in
      select * from _lineup l where l.counts and not l.played and l.position <> 'GK'
      order by array_position(array['DEF', 'MID', 'FWD'], l.position), l.player_id
    loop
      for b in select * from _lineup l where l.bench_order between 2 and 4 and l.played and not (l.player_id = any (v_used)) order by l.bench_order
      loop
        select format('%s-%s-%s',
          count(*) filter (where position = 'DEF'),
          count(*) filter (where position = 'MID'),
          count(*) filter (where position = 'FWD'))
        into v_shape
        from (
          select position from _lineup l where l.counts and l.player_id <> r.player_id and l.position <> 'GK'
          union all select b.position
        ) x;
        if v_shape = any (v_formations) then
          update _lineup l set counts = false, sub = 'off' where l.player_id = r.player_id;
          update _lineup l set counts = true, sub = 'on' where l.player_id = b.player_id;
          v_used := array_append(v_used, b.player_id);
          exit;
        end if;
      end loop;
    end loop;
  end if;

  -- Double (or with Triple Captain, treble) the captain; if the captain
  -- didn't play (known once the weekend is over), the vice-captain instead.
  select l.player_id into v_doubled from _lineup l where l.is_captain and l.counts and l.played;
  if v_doubled is null and v_settled then
    select l.player_id into v_doubled from _lineup l where l.is_vice and l.counts and l.played;
  end if;

  return query
  select l.player_id, l.is_captain, l.is_vice, l.bench_order,
    ((l.points + l.bus_points) * case when l.player_id = v_doubled then v_multiplier else 1 end)::int,
    l.played, l.counts, l.sub, l.player_id is not distinct from v_doubled, l.bus_points
  from _lineup l
  order by l.bench_order nulls first, l.player_id;
end;
$$;

create or replace function public.fixtures_walkover_clears_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.walkover is not null and old.walkover is null then
    delete from public.performances where fixture_id = new.id;
  end if;
  return new;
end;
$$;

-- Walkovers aren't games when working out which side a player plays for.
create or replace function public.refresh_player_sides()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved int;
begin
  with recent as (
    select pf.player_id, f.side_id,
      row_number() over (partition by pf.player_id order by f.kickoff desc, f.id desc) as n
    from public.performances pf
    join public.fixtures f on f.id = pf.fixture_id
    where f.goals_for is not null and f.goals_against is not null and f.walkover is null
  ),
  settled as (
    select player_id, min(side_id) as side_id
    from recent where n <= 3
    group by player_id
    having count(*) = 3 and count(distinct side_id) = 1
  ),
  moved as (
    update public.players p set side_id = s.side_id
    from settled s
    where p.id = s.player_id and not p.side_locked and p.side_id <> s.side_id
    returning p.id
  )
  select count(*) into v_moved from moved;
  return v_moved;
end;
$$;
revoke execute on function public.refresh_player_sides() from public, anon, authenticated;
grant execute on function public.refresh_player_sides() to service_role;

-- --- The Cup ------------------------------------------------------------------

create table if not exists public.cup_seeds (
  gameweek_id int not null references public.gameweeks (id) on delete cascade,
  seed int not null,
  user_id uuid references public.profiles (id) on delete set null,
  team_name text not null,
  display_name text not null,
  primary key (gameweek_id, seed)
);
alter table public.cup_seeds enable row level security;
revoke all on public.cup_seeds from anon, authenticated;

-- The Cup's entrants and seeds, frozen the first time they're asked for
-- after its first deadline: everyone with a squad for it, seeded by league
-- points before it (counted gameweeks only), ties by team name.
create or replace function public.cup_draw()
returns table (seed int, user_id uuid, team_name text, display_name text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_start public.gameweeks;
  v_from date;
begin
  select g.* into v_start from public.gameweeks g
  order by g.start_date
  offset greatest(coalesce((select s.cup_start from public.league_settings s where s.id = 1), 9) - 1, 0)
  limit 1;
  if v_start.id is null or v_start.deadline > now() then
    return;
  end if;
  if not exists (select 1 from public.cup_seeds c where c.gameweek_id = v_start.id) then
    perform pg_advisory_xact_lock(hashtext('public.cup_seeds'));
    if not exists (select 1 from public.cup_seeds c where c.gameweek_id = v_start.id) then
      perform public.league_table();
      select s.scoring_from into v_from from public.league_settings s where s.id = 1;
      insert into public.cup_seeds (gameweek_id, seed, user_id, team_name, display_name)
      select v_start.id,
        row_number() over (order by pts desc, lower(e.team_name), e.id),
        e.id, e.team_name, e.display_name
      from (
        select pr.id, pr.team_name, pr.display_name,
          coalesce((
            select sum(c.points) from public.league_cache c
            join public.gameweeks g on g.id = c.gameweek_id
            where c.user_id = pr.id and g.start_date < v_start.start_date
              and (v_from is null or g.start_date >= v_from)
          ), 0) as pts
        from public.profiles pr
        where public.squad_source_gameweek(pr.id, v_start.id) is not null
      ) e;
    end if;
  end if;
  return query
  select c.seed, c.user_id, c.team_name, c.display_name
  from public.cup_seeds c where c.gameweek_id = v_start.id order by c.seed;
end;
$$;
revoke execute on function public.cup_draw() from public;
grant execute on function public.cup_draw() to anon, authenticated;

-- --- Phone reminders ----------------------------------------------------------------

-- Turn reminders on for this phone: it moves to you if someone else had it.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Log in first.';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth);
end;
$$;
revoke execute on function public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

-- --- One-off steps ----------------------------------------------------------------

create table if not exists public.one_off_runs (
  name text primary key,
  ran_at timestamptz not null default now()
);
alter table public.one_off_runs enable row level security;
revoke all on public.one_off_runs from anon, authenticated;
-- 0032's undo has already run (pasted before it recorded itself).
insert into public.one_off_runs (name) values ('0032_undo_two_of_three') on conflict do nothing;

-- --- Fixture difficulty: super user only -----------------------------------------------

create or replace function public.league_settings_fdr_super()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The SQL editor and the server have no logged-in user: allowed.
  if new.fdr_live is distinct from old.fdr_live and auth.uid() is not null and not public.is_super() then
    raise exception 'Only the super user can switch fixture difficulty on or off.';
  end if;
  return new;
end;
$$;
drop trigger if exists league_settings_fdr_super on public.league_settings;
create trigger league_settings_fdr_super
  before update on public.league_settings
  for each row execute function public.league_settings_fdr_super();

-- --- Capt % after the deadline only -----------------------------------------------

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
  -- Captains are only shown once their deadline has passed, as FPL: the
  -- live (last locked) gameweek's.
  live as (
    select id from public.gameweeks where deadline <= now() order by start_date desc limit 1
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
    select c.player_id, count(*) as n from cur c group by c.player_id
  ),
  live_capt as (
    select p.player_id, count(*) as n
    from public.profiles pr
    join public.picks p on p.user_id = pr.id
      and p.gameweek_id = public.squad_source_gameweek(pr.id, (select id from live))
    where p.is_captain
    group by p.player_id
  ),
  live_managers as (
    select count(*) as n from public.profiles pr
    where public.squad_source_gameweek(pr.id, (select id from live)) is not null
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
    case when live_managers.n > 0 then round(100.0 * coalesce(live_capt.n, 0) / live_managers.n, 1) else 0 end,
    coalesce(ins.n, 0)::int,
    coalesce(outs.n, 0)::int
  from public.players pl
  cross join managers
  cross join live_managers
  left join owned on owned.player_id = pl.id
  left join live_capt on live_capt.player_id = pl.id
  left join ins on ins.player_id = pl.id
  left join outs on outs.player_id = pl.id;
$$;
revoke execute on function public.player_market() from public;
grant execute on function public.player_market() to anon, authenticated;

-- Points may change (walkover played): the league table rebuilds.
update public.league_cache_state set version = version + 1 where id = 1;
