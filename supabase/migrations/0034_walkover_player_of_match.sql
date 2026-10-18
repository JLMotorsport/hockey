-- Walkovers can have player of the match after all: the side votes one
-- even when nobody played. Managers can add players to a walkover again, but
-- on a walkover only player of the match (and any card) scores: no point for
-- playing, no clean sheet, win or goals conceded from the notional 5-0.
-- src/lib/scoring.ts mirrors this (StatLine.walkover).
--
-- Safe to re-run.

-- Managers may add players to a walkover again.
drop trigger if exists performances_no_walkover on public.performances;
drop function if exists public.performances_no_walkover();

-- Points with the walkover: on one, only player of the match and cards.
create or replace function public.performance_points(
  p_position text,
  p_goals int,
  p_assists int,
  p_green int,
  p_yellow int,
  p_red int,
  p_player_of_match boolean,
  p_goals_for int,
  p_goals_against int,
  p_is_home boolean,
  p_walkover boolean
)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(p_walkover, false) then
      case when p_player_of_match then 3 else 0 end - p_green - p_yellow * 2 - p_red * 4
    else public.performance_points(
      p_position, p_goals, p_assists, p_green, p_yellow, p_red,
      p_player_of_match, p_goals_for, p_goals_against, p_is_home
    )
  end;
$$;
grant execute on function public.performance_points(text, int, int, int, int, int, boolean, int, int, boolean, boolean)
  to anon, authenticated;

-- As 0015, passing the walkover.
create or replace view public.player_gameweek_points
with (security_invoker = true) as
select
  pf.player_id,
  f.gameweek_id,
  sum(public.performance_points(
    pl.position, pf.goals, pf.assists, pf.green_cards, pf.yellow_cards, pf.red_cards,
    pf.player_of_match, f.goals_for, f.goals_against, f.is_home, f.walkover is not null
  ))::int as points
from public.performances pf
join public.fixtures f on f.id = pf.fixture_id
join public.players pl on pl.id = pf.player_id
group by pf.player_id, f.gameweek_id;

create or replace function public.set_prices_from_points()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  perform public.require_admin();

  with stats as (
    select
      p.id,
      p.price as old_price,
      count(pf.id) as apps,
      coalesce(sum(public.performance_points(
        p.position, pf.goals, pf.assists, pf.green_cards, pf.yellow_cards, pf.red_cards,
        pf.player_of_match, f.goals_for, f.goals_against, f.is_home, f.walkover is not null
      )), 0) as pts
    from public.players p
    left join public.performances pf on pf.player_id = p.id
    left join public.fixtures f on f.id = pf.fixture_id
    group by p.id
  ),
  rated as (
    -- Total points first; points per game only separates equal totals.
    select id, old_price, pts + (pts::numeric / greatest(apps, 1)) / 1000 as rating
    from stats
  ),
  ranked as (
    select
      id,
      old_price,
      case when count(*) over () = 1 then 0.5
        else ((rank() over w - 1) + (cume_dist() over w * count(*) over () - 1))
             / (2.0 * (count(*) over () - 1))
      end as pr
    from rated
    window w as (order by rating)
  ),
  priced as (
    select id, old_price, 40 + (round(pr * 12) * 5)::int as new_price from ranked
  ),
  changed as (
    update public.players p set price = priced.new_price
    from priced where p.id = priced.id
    returning p.id, priced.old_price, priced.new_price
  )
  insert into public.price_changes (player_id, old_price, new_price, reason)
  select id, old_price, new_price, 'initial' from changed;
  get diagnostics v_count = row_count;

  insert into public.gameweek_pricing (gameweek_id)
  select id from public.gameweeks where deadline <= now()
  on conflict do nothing;
  return v_count;
end;
$$;

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
    pgp.player_id is not null,
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

-- The league table rebuilds with the new figures next time it's read.
update public.league_cache_state set version = version + 1 where id = 1;
