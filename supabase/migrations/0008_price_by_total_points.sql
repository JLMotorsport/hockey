-- Price by total points, everyone ranked together.
--
-- 0006 ranked players within their own position by points per game. With few
-- players in a position (or positions not yet set) a 7-point defender could
-- cost the same as a 34-point midfielder, and one big game outranked five
-- good ones. Now: more points so far always means a higher price.
--
-- Starting prices: every player ranked on total season points (points per
-- game only breaks ties), spread from 4.0m to 10.0m in 0.5m steps. Players on
-- the same total share the middle of the places they span.
--
-- Weekly changes: compared with the average of everyone who played that
-- gameweek, not just their position.
--
-- Also stores the shirt number worn in each match (for working out who a
-- withheld player is).
--
-- Safe to re-run. Replaces both functions from 0006_pricing.sql.

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
        pf.player_of_match, f.goals_for, f.goals_against
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

create or replace function public.apply_price_changes(p_gameweek int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
  v_avg numeric;
begin
  if exists (select 1 from public.gameweek_pricing where gameweek_id = p_gameweek) then
    return 0;
  end if;

  select avg(points) into v_avg from public.player_gameweek_points where gameweek_id = p_gameweek;

  with moves as (
    select
      pgp.player_id,
      p.price as old_price,
      least(public.price_ceiling(), greatest(public.price_floor(), p.price +
        case
          when pgp.points - v_avg >= 4 then 3
          when pgp.points - v_avg >= 2 then 2
          when pgp.points - v_avg >= 0.5 then 1
          when pgp.points - v_avg <= -3 then -2
          when pgp.points - v_avg <= -1 then -1
          else 0
        end)) as new_price
    from public.player_gameweek_points pgp
    join public.players p on p.id = pgp.player_id
    where pgp.gameweek_id = p_gameweek
  ),
  changed as (
    update public.players p set price = m.new_price
    from moves m
    where p.id = m.player_id and m.new_price <> m.old_price
    returning p.id, m.old_price, m.new_price
  )
  insert into public.price_changes (player_id, gameweek_id, old_price, new_price, reason)
  select id, p_gameweek, old_price, new_price, 'weekly' from changed;
  get diagnostics v_count = row_count;

  insert into public.gameweek_pricing (gameweek_id) values (p_gameweek) on conflict do nothing;
  return v_count;
end;
$$;
revoke execute on function public.apply_price_changes(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shirt numbers per match, to help managers work out who a withheld player is.
-- ---------------------------------------------------------------------------

alter table public.performances add column if not exists shirt text;

-- As in 0004_withheld_players.sql, also storing the shirt worn in each match.
create or replace function public.import_lineup(p_fixture_id int, p_players jsonb, p_withheld int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.fixtures;
  v_side_short text;
  v_player_id int;
  v_ids int[] := '{}';
  v_created int := 0;
  v_withheld boolean;
  r jsonb;
begin
  select * into v_fixture from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture % not found', p_fixture_id;
  end if;
  if v_fixture.stats_locked then
    return jsonb_build_object('skipped', true);
  end if;
  if jsonb_array_length(coalesce(p_players, '[]')) = 0 then
    return jsonb_build_object('created', 0, 'players', 0);
  end if;
  select short_name into v_side_short from public.sides where id = v_fixture.side_id;

  for r in select * from jsonb_array_elements(p_players)
  loop
    v_player_id := null;
    v_withheld := coalesce((r ->> 'withheld')::boolean, false);
    select id into v_player_id from public.players where eh_member_id = r ->> 'member_id';

    -- A named player a manager added by hand before the first sync: link by
    -- name rather than create a duplicate. (Withheld players have no name to
    -- match on; a manager merges them instead.)
    if v_player_id is null and not v_withheld then
      select id into v_player_id from public.players
      where eh_member_id is null and lower(trim(name)) = lower(trim(r ->> 'name'))
      order by (side_id = v_fixture.side_id) desc, id
      limit 1;
      if v_player_id is not null then
        update public.players set eh_member_id = r ->> 'member_id' where id = v_player_id;
      end if;
    end if;

    if v_player_id is null then
      insert into public.players (name, position, side_id, price, active, eh_member_id, needs_review, name_withheld)
      values (
        case when v_withheld
          -- Shirt number helps work out who it is; without one, a short id
          -- keeps two placeholders apart.
          then format('Name withheld #%s (%s)',
            coalesce(nullif(r ->> 'shirt', ''), left(r ->> 'member_id', 4)), v_side_short)
          else left(r ->> 'name', 120)
        end,
        case when (r ->> 'is_gk')::boolean then 'GK' else 'MID' end,
        v_fixture.side_id,
        50,
        false,
        r ->> 'member_id',
        true,
        v_withheld
      )
      returning id into v_player_id;
      v_created := v_created + 1;
    end if;

    -- Only goals and cards come from England Hockey; assists and player of
    -- the match entered by a manager are kept.
    insert into public.performances (fixture_id, player_id, shirt, goals, green_cards, yellow_cards, red_cards)
    values (
      p_fixture_id,
      v_player_id,
      nullif(r ->> 'shirt', ''),
      least(coalesce((r ->> 'goals')::int, 0), 20),
      least(coalesce((r ->> 'green_cards')::int, 0), 5),
      least(coalesce((r ->> 'yellow_cards')::int, 0), 5),
      least(coalesce((r ->> 'red_cards')::int, 0), 1)
    )
    on conflict (player_id, fixture_id) do update set
      shirt = excluded.shirt,
      goals = excluded.goals,
      green_cards = excluded.green_cards,
      yellow_cards = excluded.yellow_cards,
      red_cards = excluded.red_cards;
    v_ids := array_append(v_ids, v_player_id);
  end loop;

  -- Someone England Hockey listed before but has since removed. Players with
  -- no England Hockey id (added by hand) are never touched.
  delete from public.performances pf
  using public.players p
  where pf.fixture_id = p_fixture_id
    and p.id = pf.player_id
    and p.eh_member_id is not null
    and not (pf.player_id = any (v_ids));

  update public.fixtures
  set
    lineup_imported_at = now(),
    withheld_count = greatest(coalesce(p_withheld, 0), 0),
    stats_complete = stats_complete or coalesce(p_withheld, 0) = 0
  where id = p_fixture_id;
  return jsonb_build_object('created', v_created, 'players', cardinality(v_ids));
end;
$$;
revoke execute on function public.import_lineup(int, jsonb, int) from public, anon, authenticated;
grant execute on function public.import_lineup(int, jsonb, int) to service_role;

-- Re-read matches with withheld players on the next sync to fill in shirts.
update public.fixtures f set lineup_imported_at = null
where exists (
  select 1 from public.performances pf join public.players p on p.id = pf.player_id
  where pf.fixture_id = f.id and p.name_withheld and pf.shirt is null
);
