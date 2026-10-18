-- Players follow the side they actually play for.
--
-- * After each sync (and once now), a player's side becomes the side they
--   played for most in their last 3 games, a tie going to the most recent.
--   One game covering for another side doesn't move anyone.
-- * players.side_locked: a manager can lock a player's side by hand, and
--   then it never moves on its own.
-- * save_squad: a squad over the limit from one side because players moved
--   can be kept; it just can't add another player from that side.
--
-- Safe to re-run.

alter table public.players add column if not exists side_locked boolean not null default false;

-- Each unlocked player's side from their last 3 games; returns how many moved.
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
    select pf.player_id, f.side_id, f.kickoff,
      row_number() over (partition by pf.player_id order by f.kickoff desc, f.id desc) as n
    from public.performances pf
    join public.fixtures f on f.id = pf.fixture_id
    where f.goals_for is not null and f.goals_against is not null
  ),
  counted as (
    select player_id, side_id, count(*) as games, max(kickoff) as last_game
    from recent where n <= 3
    group by player_id, side_id
  ),
  best as (
    select distinct on (player_id) player_id, side_id
    from counted
    order by player_id, games desc, last_game desc
  ),
  moved as (
    update public.players p set side_id = b.side_id
    from best b
    where p.id = b.player_id and not p.side_locked and p.side_id <> b.side_id
    returning p.id
  )
  select count(*) into v_moved from moved;
  return v_moved;
end;
$$;
revoke execute on function public.refresh_player_sides() from public, anon, authenticated;
grant execute on function public.refresh_player_sides() to service_role;

-- As 0024, with the grace on the side limit.
create or replace function public.save_squad(p_starters int[], p_bench int[], p_captain_id int, p_vice_id int)
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
  v_starters int[] := coalesce(p_starters, '{}');
  v_bench int[] := coalesce(p_bench, '{}');
  v_ids int[];
  v_current int[];
  v_current_starters int[];
  v_previous int[] := '{}';
  v_errors text[] := '{}';
  v_shape text;
  v_base int;
  v_bank int;
  v_counts int[];
  v_live public.gameweeks;
  v_late boolean := false;
  i int;
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
  v_ids := array(select distinct unnest(v_starters || v_bench));

  -- Late entry (0021): while it's open, someone whose first squad comes
  -- after the live gameweek's deadline picks it for the live gameweek too,
  -- as a free first squad (full budget, no transfer limit).
  select * into v_live from public.gameweeks where deadline <= now() order by start_date desc limit 1;
  v_late := public.in_late_entry();

  if cardinality(v_ids) <> cardinality(v_starters) + cardinality(v_bench) then
    v_errors := array_append(v_errors, 'A player can only be picked once.');
  end if;
  if (select count(*) from public.players where id = any (v_ids)) <> cardinality(v_ids) then
    v_errors := array_append(v_errors, 'One of the selected players doesn''t exist.');
  end if;
  if cardinality(v_starters) <> 11 then
    v_errors := array_append(v_errors, format('Pick 11 starters (you have %s).', cardinality(v_starters)));
  end if;
  if cardinality(v_bench) <> 4 then
    v_errors := array_append(v_errors, format('Pick 4 subs (you have %s).', cardinality(v_bench)));
  end if;

  select array_agg(player_id) filter (where true), array_agg(player_id) filter (where bench_order is null)
  into v_current, v_current_starters
  from public.picks
  where user_id = v_user and gameweek_id = public.squad_source_gameweek(v_user, v_gw.id);
  v_current := coalesce(v_current, '{}');
  v_current_starters := coalesce(v_current_starters, '{}');

  for r in
    select name from public.players
    where id = any (v_ids) and not active and not (id = any (v_current))
  loop
    v_errors := array_append(v_errors, format('%s isn''t available for selection.', r.name));
  end loop;

  -- Starting 11: one keeper and an allowed formation.
  if (select count(*) from public.players where id = any (v_starters) and position = 'GK') <> 1 then
    v_errors := array_append(v_errors, 'Start exactly 1 goalkeeper.');
  end if;
  v_shape := format(
    '%s-%s-%s',
    (select count(*) from public.players where id = any (v_starters) and position = 'DEF'),
    (select count(*) from public.players where id = any (v_starters) and position = 'MID'),
    (select count(*) from public.players where id = any (v_starters) and position = 'FWD')
  );
  if cardinality(v_starters) = 11 and not (v_shape = any (v_settings.formations))
     and not (v_starters <@ v_current_starters and v_current_starters <@ v_starters) then
    v_errors := array_append(v_errors, format(
      'That''s a %s. Pick one of: %s.', v_shape, array_to_string(v_settings.formations, ', ')
    ));
  end if;

  -- Bench: a sub keeper first, then three outfield subs.
  if cardinality(v_bench) = 4 then
    if (select position from public.players where id = v_bench[1]) is distinct from 'GK' then
      v_errors := array_append(v_errors, 'The first sub must be a goalkeeper.');
    end if;
    if (select count(*) from public.players where id = any (v_bench[2:4]) and position = 'GK') > 0 then
      v_errors := array_append(v_errors, 'Subs 1 to 3 must be outfield players.');
    end if;
  end if;

  -- Every squad: 2 GK, 5 DEF, 5 MID, 3 FWD.
  v_counts := array[
    (select count(*) from public.players where id = any (v_ids) and position = 'GK'),
    (select count(*) from public.players where id = any (v_ids) and position = 'DEF'),
    (select count(*) from public.players where id = any (v_ids) and position = 'MID'),
    (select count(*) from public.players where id = any (v_ids) and position = 'FWD')
  ];
  if v_counts <> array[2, 5, 5, 3] then
    v_errors := array_append(v_errors, format(
      'Your 15 needs 2 GK, 5 DEF, 5 MID and 3 FWD (you have %s GK, %s DEF, %s MID, %s FWD).',
      v_counts[1], v_counts[2], v_counts[3], v_counts[4]
    ));
  end if;

  -- Over the limit for a side is refused only when the squad adds a player
  -- from it: a squad that went over because players moved side (0031) can be
  -- kept as it is.
  for r in
    select s.name, count(*) as n
    from public.players p join public.sides s on s.id = p.side_id
    where p.id = any (v_ids)
    group by s.id, s.name
    having count(*) > v_settings.max_per_side
      and bool_or(not (p.id = any (v_current)))
  loop
    v_errors := array_append(v_errors, format(
      'Max %s players from %s (you have %s). You can keep the ones you have but not add another.',
      v_settings.max_per_side, r.name, r.n
    ));
  end loop;

  if p_captain_id is null or not (p_captain_id = any (v_starters)) then
    v_errors := array_append(v_errors, 'Choose a captain from your starting 11.');
  end if;
  if p_vice_id is null or not (p_vice_id = any (v_starters)) or p_vice_id = p_captain_id then
    v_errors := array_append(v_errors, 'Choose a vice-captain from your starting 11 (not the captain).');
  end if;

  -- The squad going into this gameweek, for the bank. Extra transfers are
  -- no longer refused (0024): each one past your free transfers costs
  -- points instead, worked out by transfer_hit().
  select id into v_prev_gw from public.gameweeks
  where start_date < v_gw.start_date order by start_date desc limit 1;
  if v_prev_gw is not null and not v_late then
    v_previous := array(
      select player_id from public.picks
      where user_id = v_user and gameweek_id = public.squad_source_gameweek(v_user, v_prev_gw)
    );
  end if;

  -- The bank (see 0007_bank.sql): sales at today's price fund buys.
  if cardinality(v_previous) > 0 then
    select bank into v_base from public.squad_banks
    where user_id = v_user and gameweek_id = public.squad_source_gameweek(v_user, v_prev_gw);
    if v_base is null then
      v_base := greatest(0, v_settings.budget - (select coalesce(sum(price), 0) from public.players where id = any (v_previous)));
    end if;
  else
    v_base := v_settings.budget;
  end if;
  v_bank := v_base
    + (select coalesce(sum(price), 0) from public.players where id = any (v_previous) and not (id = any (v_ids)))
    - (select coalesce(sum(price), 0) from public.players where id = any (v_ids) and not (id = any (v_previous)));
  if v_bank < 0 then
    v_errors := array_append(v_errors, format('That''s %sm more than you can spend.', to_char(-v_bank / 10.0, 'FM990.0')));
  end if;

  if cardinality(v_errors) > 0 then
    raise exception '%', array_to_string(v_errors, E'\n');
  end if;

  insert into public.squad_banks (user_id, gameweek_id, bank) values (v_user, v_gw.id, v_bank)
  on conflict (user_id, gameweek_id) do update set bank = excluded.bank;
  delete from public.picks where user_id = v_user and gameweek_id = v_gw.id;
  insert into public.picks (user_id, gameweek_id, player_id, is_captain, is_vice, bench_order)
  select v_user, v_gw.id, s, s = p_captain_id, s = p_vice_id, null from unnest(v_starters) s;
  for i in 1 .. cardinality(v_bench) loop
    insert into public.picks (user_id, gameweek_id, player_id, is_captain, bench_order)
    values (v_user, v_gw.id, v_bench[i], false, i);
  end loop;

  if v_late then
    perform public.copy_squad(v_user, v_gw.id, v_live.id);
    update public.profiles set late_entry_gameweek = v_live.id where id = v_user;
  end if;
  return v_gw.id;
end;
$$;

select public.refresh_player_sides();
