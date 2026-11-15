-- Training points (0044). Pitchero's track and trace export (who checked in
-- to General Club Training) is uploaded each week by a manager; each day a
-- player trained between one gameweek's deadline and the next is a point for
-- that gameweek, at most 2. Training counts for a team's starting 11 whether
-- or not they played, and for a sub who comes on; like any point it's doubled
-- for the captain (and Team Bus). It's for fantasy teams only: player prices,
-- season points and Team of the Week stay match points.
-- Points count from league_settings.training_from (GW14, 9 Jan 2027).
-- Nicknames on Pitchero (Becky / Rebecca) are linked once in player_aliases.
-- Safe to re-run.

alter table public.league_settings add column if not exists training_from date;
update public.league_settings set training_from = '2027-01-09' where id = 1 and training_from is null;

create table if not exists public.training_attendance (
  player_id int not null references public.players (id) on delete cascade,
  trained_on date not null,
  primary key (player_id, trained_on)
);
alter table public.training_attendance enable row level security;
revoke all on public.training_attendance from anon, authenticated;
grant select on public.training_attendance to anon, authenticated;
drop policy if exists training_attendance_read on public.training_attendance;
create policy training_attendance_read on public.training_attendance for select using (true);

-- A Pitchero name (letters only, lower case) that's a player in the game.
create table if not exists public.player_aliases (
  alias text primary key,
  player_id int not null references public.players (id) on delete cascade
);
alter table public.player_aliases enable row level security;
revoke all on public.player_aliases from anon, authenticated;
grant select on public.player_aliases to authenticated;
drop policy if exists player_aliases_admin_read on public.player_aliases;
create policy player_aliases_admin_read on public.player_aliases for select to authenticated
  using (public.is_admin());

-- New check-ins change past scores, so the league table rebuilds.
drop trigger if exists league_cache_training on public.training_attendance;
create trigger league_cache_training after insert or update or delete on public.training_attendance
  for each statement execute function public.league_cache_bump();

-- A player's training points for a gameweek: days trained since the last
-- deadline, up to and including this one's day, at most 2. Before
-- training_from: none.
create or replace function public.training_points(p_player int, p_gameweek int)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when s.training_from is null or g.start_date < s.training_from then 0
    else least(2, (
      select count(*)::int from public.training_attendance a
      where a.player_id = p_player
        and a.trained_on <= (g.deadline at time zone 'Europe/London')::date
        and a.trained_on > coalesce((
          select (max(g2.deadline) at time zone 'Europe/London')::date
          from public.gameweeks g2 where g2.start_date < g.start_date
        ), '-infinity'::date)
    ))
  end
  from public.gameweeks g
  cross join public.league_settings s
  where g.id = p_gameweek and s.id = 1;
$$;
grant execute on function public.training_points(int, int) to anon, authenticated;

-- A week's upload: replaces the check-ins on the days the file covers, and
-- remembers the names a manager linked. Managers only.
create or replace function public.apply_training(p_days date[], p_rows jsonb, p_aliases jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Only managers can upload training.';
  end if;
  insert into public.player_aliases (alias, player_id)
  select a.alias, a.player_id
  from jsonb_to_recordset(coalesce(p_aliases, '[]')) as a(alias text, player_id int)
  where a.alias <> '' and exists (select 1 from public.players p where p.id = a.player_id)
  on conflict (alias) do update set player_id = excluded.player_id;
  delete from public.training_attendance where trained_on = any (coalesce(p_days, '{}'));
  insert into public.training_attendance (player_id, trained_on)
  select distinct r.player_id, r.trained_on
  from jsonb_to_recordset(coalesce(p_rows, '[]')) as r(player_id int, trained_on date)
  where r.trained_on = any (coalesce(p_days, '{}'))
    and exists (select 1 from public.players p where p.id = r.player_id)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.apply_training(date[], jsonb, jsonb) from public, anon;
grant execute on function public.apply_training(date[], jsonb, jsonb) to authenticated;

-- Squads return each player's training too, so the return type changes.
drop function if exists public.squad_for(uuid, int);
drop function if exists public.squad_lineup(uuid, int);

create or replace function public.squad_lineup(p_user uuid, p_gameweek int)
returns table (player_id int, is_captain boolean, is_vice boolean, bench_order smallint, points int, played boolean, counts boolean, sub text, doubled boolean, bus_points int, training int)
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
    played boolean, counts boolean, sub text, bus_points int, training int
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
    ) else 0 end,
    -- Training (0044): their check-ins that week.
    public.training_points(p.player_id, p_gameweek)
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

  -- Training is a point like any other: in the player's points, doubled for the
  -- captain, and for Team Bus when they're on the chosen side. A starter who
  -- didn't play keeps theirs even though their sub's points count instead:
  -- totals add "training" for starters that don't count (see league_table).
  update _lineup l set bus_points = l.bus_points + l.training
  where v_chip.chip = 'team_bus' and l.training > 0
    and (select pl.side_id from public.players pl where pl.id = l.player_id) = v_chip.side_id;

  return query
  select l.player_id, l.is_captain, l.is_vice, l.bench_order,
    ((l.points + l.training + l.bus_points) * case when l.player_id = v_doubled then v_multiplier else 1 end)::int,
    l.played, l.counts, l.sub, l.player_id is not distinct from v_doubled, l.bus_points, l.training
  from _lineup l
  order by l.bench_order nulls first, l.player_id;
end;
$$;
revoke execute on function public.squad_lineup(uuid, int) from public, anon, authenticated;

-- Your own squad is always visible; anyone else's only after the deadline.
create or replace function public.squad_for(p_user uuid, p_gameweek int)
returns table (player_id int, is_captain boolean, is_vice boolean, bench_order smallint, points int, played boolean, counts boolean, sub text, doubled boolean, bus_points int, training int)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_user is distinct from auth.uid()
     and not public.is_admin()
     and not exists (select 1 from public.gameweeks where id = p_gameweek and deadline <= now()) then
    raise exception 'Squads are hidden until the deadline.';
  end if;
  return query select * from public.squad_lineup(p_user, p_gameweek);
end;
$$;

-- As 0024, with training for starters who didn't play.
create or replace function public.league_table()
returns table (user_id uuid, display_name text, team_name text, total int, latest int, rank int)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_latest int;
  v_locked int[];
  v_state public.league_cache_state;
begin
  -- Points count from the gameweek scoring (re)started (0021); none set: all.
  v_locked := array(
    select g.id from public.gameweeks g
    where g.deadline <= now()
      and g.start_date >= coalesce((select scoring_from from public.league_settings where id = 1), '-infinity'::date)
    order by g.start_date
  );
  v_latest := v_locked[cardinality(v_locked)];

  -- One rebuild at a time; everyone else waits and reads the result.
  perform pg_advisory_xact_lock(hashtext('public.league_cache'));
  select * into v_state from public.league_cache_state where id = 1;
  if v_state.built_version <> v_state.version or v_state.built_gameweeks <> v_locked then
    delete from public.league_cache where true;
    insert into public.league_cache (user_id, gameweek_id, points)
    select pr.id, g.id,
      (select coalesce(sum(case when l.counts then l.points else 0 end), 0)
         -- A starter who didn't play keeps their training point (0044).
         + coalesce(sum(case when not l.counts and l.bench_order is null then l.training else 0 end), 0)
       from public.squad_lineup(pr.id, g.id) l)::int
        - public.transfer_hit(pr.id, g.id)
    from public.profiles pr
    cross join public.gameweeks g
    where g.id = any (v_locked)
      and exists (select 1 from public.picks p where p.user_id = pr.id);
    update public.league_cache_state
    set built_version = v_state.version, built_gameweeks = v_locked
    where id = 1;
  end if;

  return query
  with totals as (
    select pr.id, pr.display_name, pr.team_name,
      coalesce(sum(c.points), 0)::int as total,
      coalesce(sum(c.points) filter (where c.gameweek_id = v_latest), 0)::int as latest
    from public.profiles pr
    left join public.league_cache c on c.user_id = pr.id
    group by pr.id, pr.display_name, pr.team_name
  )
  select t.id, t.display_name, t.team_name, t.total, t.latest,
    (row_number() over (order by t.total desc, t.latest desc, lower(t.team_name)))::int
  from totals t
  order by 6;
end;
$$;

update public.league_cache_state set version = version + 1 where id = 1;
