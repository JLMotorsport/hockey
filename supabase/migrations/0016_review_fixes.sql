-- Fixes from the code review.
--
-- 1. Midweek games: a gameweek with a game before Saturday 10:00 (Monday to
--    Friday, or early Saturday) now locks an hour before that game, so nobody
--    can pick a player after seeing him score. Saturday games with no time set
--    yet (00:00) don't count. A manager's own deadline can be pulled earlier
--    by this, never later. A deadline that has passed is never moved.
-- 2. Player of the match from Pitchero: an exact full-name match first, and a
--    first-initial-and-surname match only when exactly one player fits, so
--    two Entwistles don't both get it.
-- 3. Chips: "once a season" now means this season, not ever (seasons run
--    July to June), so next season starts with every chip back.
-- 4. Merging players: when one squad had both, the captain, vice and starting
--    place move to the player kept instead of being lost.
-- 5. Formations: only those a 2 GK / 5 DEF / 5 MID / 3 FWD squad can field.
-- 6. League table: each locked gameweek's totals are kept and only worked out
--    again after points, squads or deadlines change.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Deadlines before the first game of the gameweek
-- ---------------------------------------------------------------------------

alter table public.gameweeks add column if not exists deadline_manual boolean not null default false;

create or replace function public.refresh_deadline(p_gameweek_id int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gw public.gameweeks;
  v_default timestamptz;
  v_first timestamptz;
  v_new timestamptz;
begin
  select * into v_gw from public.gameweeks where id = p_gameweek_id for update;
  if not found or v_gw.deadline <= now() then
    return; -- gone, or already locked: never move a deadline that has passed
  end if;
  v_default := (v_gw.start_date + time '10:00') at time zone 'Europe/London';
  select min(f.kickoff) into v_first
  from public.fixtures f
  where f.gameweek_id = p_gameweek_id
    and f.kickoff < v_default
    -- A Saturday game at 00:00 has no time set yet.
    and not ((f.kickoff at time zone 'Europe/London')::date = v_gw.start_date
             and (f.kickoff at time zone 'Europe/London')::time = time '00:00');
  v_new := case when v_first is null then v_default else least(v_default, v_first - interval '1 hour') end;
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

create or replace function public.fixtures_refresh_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.refresh_deadline(old.gameweek_id);
  end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.gameweek_id is distinct from old.gameweek_id
                            or new.kickoff is distinct from old.kickoff) then
    perform public.refresh_deadline(new.gameweek_id);
  end if;
  return null;
end;
$$;

drop trigger if exists fixtures_refresh_deadline on public.fixtures;
create trigger fixtures_refresh_deadline
  after insert or update of kickoff, gameweek_id or delete on public.fixtures
  for each row execute function public.fixtures_refresh_deadline();

-- A manager's deadline is remembered, so a midweek game can only bring it forward.
create or replace function public.set_deadline(p_gameweek_id int, p_deadline timestamp)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.gameweeks
  set deadline = p_deadline at time zone 'Europe/London', deadline_manual = true
  where id = p_gameweek_id;
  perform public.refresh_deadline(p_gameweek_id);
end;
$$;

-- Bring every open gameweek into line now.
do $$
declare
  r record;
begin
  for r in select id from public.gameweeks where deadline > now() loop
    perform public.refresh_deadline(r.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Player of the match: no doubling up on a shared initial and surname
-- ---------------------------------------------------------------------------

create or replace function public.import_pitchero(p_fixture_id int, p_lineup jsonb, p_potm jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.fixtures;
  v_potm int := 0;
  v_name text;
  v_ids int[];
begin
  select * into v_fixture from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture % not found', p_fixture_id;
  end if;

  delete from public.pitchero_lineups where fixture_id = p_fixture_id;
  insert into public.pitchero_lineups (fixture_id, pitchero_player_id, name, shirt, position, starter)
  select
    p_fixture_id,
    (r ->> 'pitchero_player_id')::int,
    left(r ->> 'name', 120),
    nullif(r ->> 'shirt', ''),
    nullif(r ->> 'position', ''),
    coalesce((r ->> 'starter')::boolean, true)
  from jsonb_array_elements(coalesce(p_lineup, '[]')) r
  on conflict do nothing;

  -- Player of the match, if the match has none yet and isn't locked. The full
  -- name first; failing that, initial and surname, but only if one player fits.
  if not v_fixture.stats_locked
     and not exists (select 1 from public.performances where fixture_id = p_fixture_id and player_of_match) then
    for v_name in select jsonb_array_elements_text(coalesce(p_potm, '[]'))
    loop
      select array_agg(pf.id) into v_ids
      from public.performances pf join public.players p on p.id = pf.player_id
      where pf.fixture_id = p_fixture_id and not p.name_withheld
        and lower(trim(p.name)) = lower(trim(v_name));
      if coalesce(cardinality(v_ids), 0) = 0 then
        select array_agg(pf.id) into v_ids
        from public.performances pf join public.players p on p.id = pf.player_id
        where pf.fixture_id = p_fixture_id and not p.name_withheld
          and public.name_key(p.name) = public.name_key(v_name);
      end if;
      if cardinality(v_ids) = 1 then
        update public.performances set player_of_match = true where id = v_ids[1];
        v_potm := v_potm + 1;
      end if;
    end loop;
  end if;

  update public.fixtures set pitchero_imported_at = now() where id = p_fixture_id;
  return jsonb_build_object('players', jsonb_array_length(coalesce(p_lineup, '[]')), 'potm', v_potm);
end;
$$;
revoke execute on function public.import_pitchero(int, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.import_pitchero(int, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Chips are once a season, this season
-- ---------------------------------------------------------------------------

-- The year a season starts in: July 2026 to June 2027 is 2026.
create or replace function public.season_of(p_date date)
returns int
language sql
immutable
set search_path = ''
as $$
  select extract(year from p_date - interval '6 months')::int;
$$;

create or replace function public.play_chip(p_chip text, p_side_id int default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_gw public.gameweeks;
  v_current public.chips_played;
begin
  if v_user is null then
    raise exception 'Log in to play a chip.';
  end if;
  select * into v_gw from public.gameweeks where deadline > now() order by start_date limit 1;
  if not found then
    raise exception 'There''s no upcoming gameweek to play a chip in.';
  end if;
  if p_chip not in ('triple_captain', 'rolling_subs', 'wildcard', 'team_bus') then
    raise exception 'Unknown chip.';
  end if;
  if p_chip = 'team_bus' and not exists (select 1 from public.sides where id = p_side_id) then
    raise exception 'Choose a side for the Team Bus.';
  end if;

  select * into v_current from public.chips_played where user_id = v_user and gameweek_id = v_gw.id for update;
  if v_current.chip = 'wildcard' and p_chip <> 'wildcard' then
    raise exception 'You''ve played your wildcard this gameweek, and it can''t be taken back.';
  end if;

  if p_chip = 'wildcard' then
    if exists (
      select 1 from public.chips_played c join public.gameweeks g on g.id = c.gameweek_id
      where c.user_id = v_user and c.chip = 'wildcard' and c.gameweek_id <> v_gw.id
        and public.season_of(g.start_date) = public.season_of(v_gw.start_date)
        and public.season_half(g.start_date) = public.season_half(v_gw.start_date)
    ) then
      raise exception 'You''ve already used your wildcard for this half of the season.';
    end if;
  elsif exists (
    select 1 from public.chips_played c join public.gameweeks g on g.id = c.gameweek_id
    where c.user_id = v_user and c.chip = p_chip and c.gameweek_id <> v_gw.id
      and public.season_of(g.start_date) = public.season_of(v_gw.start_date)
  ) then
    raise exception 'You''ve already used that chip this season.';
  end if;

  insert into public.chips_played (user_id, gameweek_id, chip, side_id)
  values (v_user, v_gw.id, p_chip, case when p_chip = 'team_bus' then p_side_id end)
  on conflict (user_id, gameweek_id) do update
    set chip = excluded.chip, side_id = excluded.side_id, played_at = now();
  return v_gw.id;
end;
$$;
revoke execute on function public.play_chip(text, int) from public, anon;
grant execute on function public.play_chip(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Merging players keeps the captain, vice and starting place
-- ---------------------------------------------------------------------------

create or replace function public.merge_players(p_from int, p_into int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.players;
  v_into public.players;
  r record;
begin
  perform public.require_admin();
  if p_from = p_into then
    raise exception 'Pick a different player to merge into.';
  end if;
  select * into v_from from public.players where id = p_from for update;
  select * into v_into from public.players where id = p_into for update;
  if v_from.id is null or v_into.id is null then
    raise exception 'Player not found.';
  end if;
  if v_from.eh_member_id is not null and v_into.eh_member_id is not null
     and v_from.eh_member_id <> v_into.eh_member_id then
    raise exception '% and % are different people on England Hockey.', v_from.name, v_into.name;
  end if;

  -- Same match on both: England Hockey's goals and cards win, the manager's
  -- assists and player of the match are kept.
  update public.performances t
  set
    goals = f.goals,
    green_cards = f.green_cards,
    yellow_cards = f.yellow_cards,
    red_cards = f.red_cards,
    assists = greatest(t.assists, f.assists),
    player_of_match = t.player_of_match or f.player_of_match
  from public.performances f
  where f.player_id = p_from and t.player_id = p_into and t.fixture_id = f.fixture_id;
  delete from public.performances f
  where f.player_id = p_from
    and exists (select 1 from public.performances t where t.player_id = p_into and t.fixture_id = f.fixture_id);
  update public.performances set player_id = p_into where player_id = p_from;

  -- A squad with both: drop the merged pick, but hand its armband and
  -- starting place to the one kept (after the delete, so no clash).
  for r in
    select f.user_id, f.gameweek_id, f.is_captain, f.is_vice, f.bench_order
    from public.picks f
    where f.player_id = p_from
      and exists (
        select 1 from public.picks t
        where t.player_id = p_into and t.user_id = f.user_id and t.gameweek_id = f.gameweek_id
      )
  loop
    delete from public.picks
    where player_id = p_from and user_id = r.user_id and gameweek_id = r.gameweek_id;
    update public.picks t
    set is_captain = t.is_captain or r.is_captain,
        is_vice = (t.is_vice or r.is_vice) and not (t.is_captain or r.is_captain),
        bench_order = case when r.bench_order is null then null else t.bench_order end
    where t.player_id = p_into and t.user_id = r.user_id and t.gameweek_id = r.gameweek_id;
  end loop;
  update public.picks set player_id = p_into where player_id = p_from;

  delete from public.players where id = p_from;
  update public.players
  set eh_member_id = coalesce(v_into.eh_member_id, v_from.eh_member_id)
  where id = p_into;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Formations a 2/5/5/3 squad can actually field
-- ---------------------------------------------------------------------------

update public.league_settings
set formations = array(
  select f from unnest(formations) f
  where f = any (array['4-4-2', '4-3-3', '3-4-3', '3-5-2', '5-3-2', '4-5-1', '5-4-1', '5-2-3'])
)
where true;
update public.league_settings
set formations = array['4-4-2', '4-3-3', '3-4-3', '3-5-2', '5-3-2', '4-5-1', '5-4-1']
where cardinality(formations) = 0;

alter table public.league_settings drop constraint if exists league_settings_formations_check;
alter table public.league_settings add constraint league_settings_formations_check check (
  cardinality(formations) > 0
  and formations <@ array['4-4-2', '4-3-3', '3-4-3', '3-5-2', '5-3-2', '4-5-1', '5-4-1', '5-2-3']
);

-- ---------------------------------------------------------------------------
-- 6. League table: keep each locked gameweek's totals
-- ---------------------------------------------------------------------------

create table if not exists public.league_cache (
  user_id uuid not null,
  gameweek_id int not null,
  points int not null,
  primary key (user_id, gameweek_id)
);
alter table public.league_cache enable row level security;
revoke all on public.league_cache from anon, authenticated;

create table if not exists public.league_cache_state (
  id int primary key default 1 check (id = 1),
  version bigint not null default 1,
  built_version bigint not null default 0,
  built_gameweeks int[] not null default '{}'
);
alter table public.league_cache_state enable row level security;
revoke all on public.league_cache_state from anon, authenticated;
insert into public.league_cache_state (id) values (1) on conflict do nothing;
-- Rebuild after this migration (performance_points may have changed).
update public.league_cache_state set version = version + 1 where id = 1;

create or replace function public.league_cache_bump()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.league_cache_state set version = version + 1 where id = 1;
  return null;
end;
$$;

-- Squads and chips only matter once their gameweek is locked; saving next
-- week's team shouldn't throw the table away.
create or replace function public.league_cache_bump_locked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gw int := case when tg_op = 'DELETE' then old.gameweek_id else new.gameweek_id end;
begin
  if exists (select 1 from public.gameweeks where id = v_gw and deadline <= now()) then
    update public.league_cache_state set version = version + 1 where id = 1;
  end if;
  return null;
end;
$$;

drop trigger if exists league_cache_performances on public.performances;
create trigger league_cache_performances after insert or update or delete on public.performances
  for each statement execute function public.league_cache_bump();
drop trigger if exists league_cache_fixtures on public.fixtures;
create trigger league_cache_fixtures after insert or update or delete on public.fixtures
  for each statement execute function public.league_cache_bump();
drop trigger if exists league_cache_players on public.players;
create trigger league_cache_players after insert or update or delete on public.players
  for each statement execute function public.league_cache_bump();
drop trigger if exists league_cache_gameweeks on public.gameweeks;
create trigger league_cache_gameweeks after insert or update or delete on public.gameweeks
  for each statement execute function public.league_cache_bump();
drop trigger if exists league_cache_picks on public.picks;
create trigger league_cache_picks after insert or update or delete on public.picks
  for each row execute function public.league_cache_bump_locked();
drop trigger if exists league_cache_chips on public.chips_played;
create trigger league_cache_chips after insert or update or delete on public.chips_played
  for each row execute function public.league_cache_bump_locked();

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
  v_locked := array(select id from public.gameweeks where deadline <= now() order by start_date);
  v_latest := v_locked[cardinality(v_locked)];

  -- One rebuild at a time; everyone else waits and reads the result.
  perform pg_advisory_xact_lock(hashtext('public.league_cache'));
  select * into v_state from public.league_cache_state where id = 1;
  if v_state.built_version <> v_state.version or v_state.built_gameweeks <> v_locked then
    delete from public.league_cache where true;
    insert into public.league_cache (user_id, gameweek_id, points)
    select pr.id, g.id,
      (select coalesce(sum(l.points), 0) from public.squad_lineup(pr.id, g.id) l where l.counts)::int
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
