-- Game logic: gameweeks, scoring, squads, league table and manager actions.
-- Safe to re-run. Points rules mirror src/lib/scoring.ts (tests keep them in step).

-- ---------------------------------------------------------------------------
-- Gameweeks
-- ---------------------------------------------------------------------------

-- The gameweek for a UK calendar date: the Saturday of its Monday-to-Sunday
-- week, deadline 10:00 UK time that Saturday. Created on first use.
create or replace function public.ensure_gameweek(p_day date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saturday date := p_day - (extract(isodow from p_day)::int - 1) + 5;
  v_id int;
begin
  insert into public.gameweeks (start_date, deadline)
  values (v_saturday, (v_saturday + time '10:00') at time zone 'Europe/London')
  on conflict (start_date) do nothing;
  select id into v_id from public.gameweeks where start_date = v_saturday;
  return v_id;
end;
$$;
revoke execute on function public.ensure_gameweek(date) from public, anon, authenticated;

create or replace function public.fixtures_set_gameweek()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.gameweek_id := public.ensure_gameweek((new.kickoff at time zone 'Europe/London')::date);
  return new;
end;
$$;

drop trigger if exists fixtures_set_gameweek on public.fixtures;
create trigger fixtures_set_gameweek
  before insert or update of kickoff on public.fixtures
  for each row execute function public.fixtures_set_gameweek();

-- ---------------------------------------------------------------------------
-- Scoring
-- ---------------------------------------------------------------------------

create or replace function public.performance_points(
  p_position text,
  p_goals int,
  p_assists int,
  p_green int,
  p_yellow int,
  p_red int,
  p_player_of_match boolean,
  p_goals_for int,
  p_goals_against int
)
returns int
language sql
immutable
set search_path = ''
as $$
  select
    1
    + p_goals * case p_position when 'GK' then 6 when 'DEF' then 6 when 'MID' then 5 else 4 end
    + p_assists * 3
    + case when p_goals_for is null or p_goals_against is null then 0 else
        -- Clean sheet
        case when p_goals_against = 0 then
          case p_position when 'GK' then 4 when 'DEF' then 4 when 'MID' then 1 else 0 end
        else 0 end
        -- GK and DEF lose a point for every 2 conceded
        - case when p_position in ('GK', 'DEF') then p_goals_against / 2 else 0 end
        -- Team win
        + case when p_goals_for > p_goals_against then 2 else 0 end
      end
    + case when p_player_of_match then 3 else 0 end
    - p_green
    - p_yellow * 2
    - p_red * 4;
$$;

-- Points per player per gameweek. A player who turns out for two Felixstowe
-- sides in one weekend scores for both games.
create or replace view public.player_gameweek_points
with (security_invoker = true) as
select
  pf.player_id,
  f.gameweek_id,
  sum(public.performance_points(
    pl.position, pf.goals, pf.assists, pf.green_cards, pf.yellow_cards, pf.red_cards,
    pf.player_of_match, f.goals_for, f.goals_against
  ))::int as points
from public.performances pf
join public.fixtures f on f.id = pf.fixture_id
join public.players pl on pl.id = pf.player_id
group by pf.player_id, f.gameweek_id;

create or replace view public.player_season_points
with (security_invoker = true) as
select player_id, sum(points)::int as points
from public.player_gameweek_points
group by player_id;

-- ---------------------------------------------------------------------------
-- Squads
-- ---------------------------------------------------------------------------

-- The gameweek whose saved picks apply to `p_gameweek` for `p_user`. Internal:
-- it reads picks past RLS, so it is only callable from other functions.
create or replace function public.squad_source_gameweek(p_user uuid, p_gameweek int)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select g.id
  from public.gameweeks g
  where g.start_date <= (select start_date from public.gameweeks where id = p_gameweek)
    and exists (select 1 from public.picks p where p.user_id = p_user and p.gameweek_id = g.id)
  order by g.start_date desc
  limit 1;
$$;
revoke execute on function public.squad_source_gameweek(uuid, int) from public, anon, authenticated;

-- Someone's squad for a gameweek, with each player's points (captain doubled).
-- Your own squad is always visible; anyone else's only after the deadline.
create or replace function public.squad_for(p_user uuid, p_gameweek int)
returns table (player_id int, is_captain boolean, points int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user is distinct from auth.uid()
     and not public.is_admin()
     and not exists (select 1 from public.gameweeks where id = p_gameweek and deadline <= now()) then
    raise exception 'Squads are hidden until the deadline.';
  end if;

  return query
  select
    p.player_id,
    p.is_captain,
    (coalesce(pgp.points, 0) * case when p.is_captain then 2 else 1 end)::int
  from public.picks p
  left join public.player_gameweek_points pgp
    on pgp.player_id = p.player_id and pgp.gameweek_id = p_gameweek
  where p.user_id = p_user
    and p.gameweek_id = public.squad_source_gameweek(p_user, p_gameweek);
end;
$$;

-- Save the caller's squad for the next gameweek that hasn't locked. Every rule
-- is checked here; the website only mirrors them for a live summary. Problems
-- come back as one exception, one message per line.
create or replace function public.save_squad(p_player_ids int[], p_captain_id int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_gw public.gameweeks;
  v_prev_gw int;
  v_settings public.league_settings;
  v_ids int[];
  v_current int[];
  v_previous int[];
  v_errors text[] := '{}';
  v_cost int;
  v_transfers int;
  r record;
begin
  if v_user is null then
    raise exception 'Log in to pick a squad.';
  end if;

  select * into v_gw from public.gameweeks where deadline > now() order by start_date limit 1;
  if not found then
    raise exception 'There''s no upcoming gameweek to pick for yet.';
  end if;

  select * into v_settings from public.league_settings where id = 1;
  v_ids := array(select distinct unnest(coalesce(p_player_ids, '{}')));

  if cardinality(v_ids) <> cardinality(coalesce(p_player_ids, '{}')) then
    v_errors := array_append(v_errors, 'A player can only be picked once.');
  end if;
  if (select count(*) from public.players where id = any (v_ids)) <> cardinality(v_ids) then
    v_errors := array_append(v_errors, 'One of the selected players doesn''t exist.');
  end if;
  if cardinality(v_ids) <> v_settings.squad_size then
    v_errors := array_append(v_errors, format('Pick exactly %s players (you have %s).', v_settings.squad_size, cardinality(v_ids)));
  end if;

  v_current := array(
    select player_id from public.picks
    where user_id = v_user and gameweek_id = public.squad_source_gameweek(v_user, v_gw.id)
  );

  for r in
    select name from public.players
    where id = any (v_ids) and not active and not (id = any (v_current))
  loop
    v_errors := array_append(v_errors, format('%s isn''t available for selection.', r.name));
  end loop;

  if (select count(*) from public.players where id = any (v_ids) and position = 'GK') <> 1 then
    v_errors := array_append(v_errors, 'Pick exactly 1 goalkeeper.');
  end if;
  if (select count(*) from public.players where id = any (v_ids) and position = 'DEF') < 3 then
    v_errors := array_append(v_errors, 'Pick at least 3 DEF.');
  end if;
  if (select count(*) from public.players where id = any (v_ids) and position = 'MID') < 3 then
    v_errors := array_append(v_errors, 'Pick at least 3 MID.');
  end if;
  if (select count(*) from public.players where id = any (v_ids) and position = 'FWD') < 1 then
    v_errors := array_append(v_errors, 'Pick at least 1 FWD.');
  end if;

  -- Price rises shouldn't stop someone keeping the same squad (e.g. just
  -- changing captain), so the budget only applies when players change.
  select coalesce(sum(price), 0) into v_cost from public.players where id = any (v_ids);
  if v_cost > v_settings.budget and not (v_ids <@ v_current and v_current <@ v_ids) then
    v_errors := array_append(v_errors, format(
      'Squad costs %sm, over the %sm budget.',
      to_char(v_cost / 10.0, 'FM990.0'), to_char(v_settings.budget / 10.0, 'FM9990.0')
    ));
  end if;

  for r in
    select s.name, count(*) as n
    from public.players p join public.sides s on s.id = p.side_id
    where p.id = any (v_ids)
    group by s.name
    having count(*) > v_settings.max_per_side
  loop
    v_errors := array_append(v_errors, format('Max %s players from %s (you have %s).', v_settings.max_per_side, r.name, r.n));
  end loop;

  if p_captain_id is null or not (p_captain_id = any (v_ids)) then
    v_errors := array_append(v_errors, 'Choose a captain from your squad.');
  end if;

  -- Transfers count against the squad going into this gameweek, so saving
  -- several times before one deadline doesn't use extra transfers. The first
  -- squad is free.
  select id into v_prev_gw from public.gameweeks
  where start_date < v_gw.start_date order by start_date desc limit 1;
  if v_prev_gw is not null then
    v_previous := array(
      select player_id from public.picks
      where user_id = v_user and gameweek_id = public.squad_source_gameweek(v_user, v_prev_gw)
    );
    if cardinality(v_previous) > 0 then
      v_transfers := (select count(*) from unnest(v_ids) i where not (i = any (v_previous)));
      if v_transfers > v_settings.transfers_per_gameweek then
        v_errors := array_append(v_errors, format(
          'That''s %s transfers; only %s allowed per gameweek.', v_transfers, v_settings.transfers_per_gameweek
        ));
      end if;
    end if;
  end if;

  if cardinality(v_errors) > 0 then
    raise exception '%', array_to_string(v_errors, E'\n');
  end if;

  delete from public.picks where user_id = v_user and gameweek_id = v_gw.id;
  insert into public.picks (user_id, gameweek_id, player_id, is_captain)
  select v_user, v_gw.id, i, i = p_captain_id from unnest(v_ids) i;
  return v_gw.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- League table
-- ---------------------------------------------------------------------------

-- Totals over every gameweek whose deadline has passed.
create or replace function public.league_table()
returns table (
  user_id uuid,
  display_name text,
  team_name text,
  total int,
  latest int,
  rank int
)
language sql
stable
security definer
set search_path = ''
as $$
  with locked as (
    select id, start_date from public.gameweeks where deadline <= now()
  ),
  latest_gw as (
    select id from locked order by start_date desc limit 1
  ),
  sources as (
    select pr.id as user_id, l.id as gameweek_id, public.squad_source_gameweek(pr.id, l.id) as source_id
    from public.profiles pr cross join locked l
  ),
  scored as (
    select
      s.user_id,
      s.gameweek_id,
      sum(coalesce(pgp.points, 0) * case when p.is_captain then 2 else 1 end) as points
    from sources s
    join public.picks p on p.user_id = s.user_id and p.gameweek_id = s.source_id
    left join public.player_gameweek_points pgp
      on pgp.player_id = p.player_id and pgp.gameweek_id = s.gameweek_id
    group by s.user_id, s.gameweek_id
  ),
  totals as (
    select
      pr.id,
      pr.display_name,
      pr.team_name,
      coalesce(sum(sc.points), 0)::int as total,
      coalesce(sum(sc.points) filter (where sc.gameweek_id = (select id from latest_gw)), 0)::int as latest
    from public.profiles pr
    left join scored sc on sc.user_id = pr.id
    group by pr.id, pr.display_name, pr.team_name
  )
  select
    id, display_name, team_name, total, latest,
    (row_number() over (order by total desc, latest desc, lower(team_name)))::int
  from totals
  order by 6;
$$;

-- ---------------------------------------------------------------------------
-- Manager actions
-- ---------------------------------------------------------------------------

create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'League managers only.';
  end if;
end;
$$;

-- Record who played in a fixture and what they did, replacing what was there.
-- Passing both scores marks the score as entered by hand so sync leaves it;
-- passing neither hands the score back to England Hockey.
create or replace function public.save_match_stats(
  p_fixture_id int,
  p_goals_for int,
  p_goals_against int,
  p_stats jsonb,
  p_complete boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.fixtures;
  v_player_ids int[];
begin
  perform public.require_admin();
  select * into v_fixture from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  if p_goals_for is not null and p_goals_against is not null then
    if (p_goals_for, p_goals_against) is distinct from (v_fixture.goals_for, v_fixture.goals_against) then
      update public.fixtures
      set goals_for = p_goals_for, goals_against = p_goals_against, score_overridden = true
      where id = p_fixture_id;
    end if;
  elsif p_goals_for is null and p_goals_against is null and v_fixture.score_overridden then
    update public.fixtures set score_overridden = false where id = p_fixture_id;
  end if;

  v_player_ids := array(select (s ->> 'player_id')::int from jsonb_array_elements(coalesce(p_stats, '[]')) s);
  delete from public.performances
  where fixture_id = p_fixture_id and not (player_id = any (v_player_ids));

  insert into public.performances (
    fixture_id, player_id, goals, assists, green_cards, yellow_cards, red_cards, player_of_match
  )
  select
    p_fixture_id,
    (s ->> 'player_id')::int,
    coalesce((s ->> 'goals')::int, 0),
    coalesce((s ->> 'assists')::int, 0),
    coalesce((s ->> 'green_cards')::int, 0),
    coalesce((s ->> 'yellow_cards')::int, 0),
    coalesce((s ->> 'red_cards')::int, 0),
    coalesce((s ->> 'player_of_match')::boolean, false)
  from jsonb_array_elements(coalesce(p_stats, '[]')) s
  on conflict (player_id, fixture_id) do update set
    goals = excluded.goals,
    assists = excluded.assists,
    green_cards = excluded.green_cards,
    yellow_cards = excluded.yellow_cards,
    red_cards = excluded.red_cards,
    player_of_match = excluded.player_of_match;

  update public.fixtures set stats_complete = coalesce(p_complete, false) where id = p_fixture_id;
end;
$$;

-- Manual fixtures (cups, friendlies). The kickoff is UK wall-clock time as
-- typed into the form.
create or replace function public.add_fixture(
  p_side_id int,
  p_opponent text,
  p_kickoff timestamp,
  p_is_home boolean,
  p_competition text
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id int;
begin
  perform public.require_admin();
  if coalesce(trim(p_opponent), '') = '' then
    raise exception 'Enter the opponent.';
  end if;
  insert into public.fixtures (side_id, opponent, kickoff, is_home, competition)
  values (
    p_side_id, trim(p_opponent), p_kickoff at time zone 'Europe/London', p_is_home,
    coalesce(nullif(trim(p_competition), ''), 'Friendly / cup')
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.set_deadline(p_gameweek_id int, p_deadline timestamp)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.gameweeks set deadline = p_deadline at time zone 'Europe/London' where id = p_gameweek_id;
end;
$$;

create or replace function public.set_admin(p_user uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  if p_user = auth.uid() then
    raise exception 'You can''t change your own manager access.';
  end if;
  update public.profiles set is_admin = p_value where id = p_user;
end;
$$;

-- Accounts with email addresses, for the manager's users page.
create or replace function public.admin_users()
returns table (id uuid, email text, display_name text, team_name text, is_admin boolean, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select p.id, u.email::text, p.display_name, p.team_name, p.is_admin, p.created_at
  from public.profiles p join auth.users u on u.id = p.id
  order by lower(p.display_name);
end;
$$;

-- ---------------------------------------------------------------------------
-- England Hockey import (called by the eh-sync Edge Function only)
-- ---------------------------------------------------------------------------

-- p_rows: [{eh_fixture_id, kickoff (UK local, no offset), opponent, is_home,
-- goals_for, goals_against}]. Scores only update when present and the
-- manager hasn't entered the score by hand.
create or replace function public.import_fixtures(p_side_id int, p_competition text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created int := 0;
  v_updated int := 0;
  v_inserted boolean;
  r jsonb;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'))
  loop
    insert into public.fixtures (
      side_id, eh_fixture_id, kickoff, opponent, is_home, competition, goals_for, goals_against
    )
    values (
      p_side_id,
      r ->> 'eh_fixture_id',
      (r ->> 'kickoff')::timestamp at time zone 'Europe/London',
      r ->> 'opponent',
      (r ->> 'is_home')::boolean,
      p_competition,
      (r ->> 'goals_for')::int,
      (r ->> 'goals_against')::int
    )
    on conflict (side_id, eh_fixture_id) do update set
      kickoff = excluded.kickoff,
      opponent = excluded.opponent,
      is_home = excluded.is_home,
      competition = excluded.competition,
      goals_for = case
        when fixtures.score_overridden or excluded.goals_for is null or excluded.goals_against is null
        then fixtures.goals_for else excluded.goals_for end,
      goals_against = case
        when fixtures.score_overridden or excluded.goals_for is null or excluded.goals_against is null
        then fixtures.goals_against else excluded.goals_against end
    returning (xmax = 0) into v_inserted;

    if v_inserted then v_created := v_created + 1; else v_updated := v_updated + 1; end if;
  end loop;

  if p_competition is not null then
    update public.sides set competition = p_competition where id = p_side_id;
  end if;
  return jsonb_build_object('created', v_created, 'updated', v_updated);
end;
$$;
revoke execute on function public.import_fixtures(int, text, jsonb) from public, anon, authenticated;
grant execute on function public.import_fixtures(int, text, jsonb) to service_role;
