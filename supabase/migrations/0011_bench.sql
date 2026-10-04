-- Subs bench, as in FPL.
--
-- A squad is 11 starters in an allowed formation plus a bench of 4: a sub
-- goalkeeper and three outfield subs in order. Once a gameweek's weekend is
-- over (from the Monday), anyone in the starting 11 who didn't play is
-- replaced automatically: the keeper by the sub keeper, outfield players by
-- the first outfield sub (in bench order) who did play, so long as the team
-- still lines up in an allowed formation. A captain who didn't play scores
-- nothing to double, so the vice-captain's points are doubled instead (if
-- they played and are in the 11 that count).
--
-- Squads saved before this (11 players, no bench) keep scoring as they are;
-- their next save can add the 4 bench players without it counting as
-- transfers.
--
-- Safe to re-run. Replaces save_squad (new arguments), squad_for (new
-- columns) and league_table.

-- Null = in the starting 11. 1 = sub keeper, 2..4 = outfield subs in order.
alter table public.picks add column if not exists bench_order smallint check (bench_order between 1 and 4);
alter table public.picks add column if not exists is_vice boolean not null default false;

alter table public.league_settings drop constraint if exists league_settings_squad_size_check;
update public.league_settings set squad_size = 15;
alter table public.league_settings add constraint league_settings_squad_size_check check (squad_size = 15);
alter table public.league_settings alter column squad_size set default 15;

-- ---------------------------------------------------------------------------
-- Saving a squad
-- ---------------------------------------------------------------------------

drop function if exists public.save_squad(int[], int);
drop function if exists public.save_squad(int[], int[], int);

-- p_starters: the 11. p_bench: [sub keeper, sub 1, sub 2, sub 3].
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
  v_transfers int;
  v_shape text;
  v_base int;
  v_bank int;
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

  for r in
    select s.name, count(*) as n
    from public.players p join public.sides s on s.id = p.side_id
    where p.id = any (v_ids)
    group by s.name
    having count(*) > v_settings.max_per_side
  loop
    v_errors := array_append(v_errors, format('Max %s players from %s (you have %s).', v_settings.max_per_side, r.name, r.n));
  end loop;

  if p_captain_id is null or not (p_captain_id = any (v_starters)) then
    v_errors := array_append(v_errors, 'Choose a captain from your starting 11.');
  end if;
  if p_vice_id is null or not (p_vice_id = any (v_starters)) or p_vice_id = p_captain_id then
    v_errors := array_append(v_errors, 'Choose a vice-captain from your starting 11 (not the captain).');
  end if;

  -- Transfers count against the squad going into this gameweek. A squad
  -- from before the bench existed may add players up to 15 for free.
  select id into v_prev_gw from public.gameweeks
  where start_date < v_gw.start_date order by start_date desc limit 1;
  if v_prev_gw is not null then
    v_previous := array(
      select player_id from public.picks
      where user_id = v_user and gameweek_id = public.squad_source_gameweek(v_user, v_prev_gw)
    );
    if cardinality(v_previous) > 0 then
      v_transfers := (select count(*) from unnest(v_ids) x where not (x = any (v_previous)))
        - greatest(0, 15 - cardinality(v_previous));
      if v_transfers > v_settings.transfers_per_gameweek then
        v_errors := array_append(v_errors, format(
          'That''s %s transfers; only %s allowed per gameweek.', v_transfers, v_settings.transfers_per_gameweek
        ));
      end if;
    end if;
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
  return v_gw.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scoring with automatic substitutions
-- ---------------------------------------------------------------------------

-- Someone's squad for a gameweek with each player's points, whether they
-- count (starting 11 after auto-subs) and how they got there. Internal: it
-- reads picks past RLS. Auto-subs only once the weekend is over.
create or replace function public.squad_lineup(p_user uuid, p_gameweek int)
returns table (player_id int, is_captain boolean, is_vice boolean, bench_order smallint, points int, played boolean, counts boolean, sub text, doubled boolean)
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
begin
  select * into v_gw from public.gameweeks where id = p_gameweek;
  select formations into v_formations from public.league_settings where id = 1;
  v_settled := v_gw.deadline <= now() and v_gw.start_date + 2 <= (now() at time zone 'Europe/London')::date;

  create temp table if not exists _lineup (
    player_id int, is_captain boolean, is_vice boolean, bench_order smallint, position text, points int,
    played boolean, counts boolean, sub text
  ) on commit drop;
  delete from _lineup where true; -- (safeupdate needs a where)
  insert into _lineup
  select
    p.player_id, p.is_captain, p.is_vice, p.bench_order, pl.position,
    coalesce(pgp.points, 0),
    pgp.player_id is not null,
    p.bench_order is null,
    null
  from public.picks p
  join public.players pl on pl.id = p.player_id
  left join public.player_gameweek_points pgp on pgp.player_id = p.player_id and pgp.gameweek_id = p_gameweek
  where p.user_id = p_user and p.gameweek_id = public.squad_source_gameweek(p_user, p_gameweek);

  if v_settled and exists (select 1 from _lineup where _lineup.bench_order is not null) then
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

  -- Double the captain; if the captain didn't play (known once the weekend
  -- is over), the vice-captain instead.
  select l.player_id into v_doubled from _lineup l where l.is_captain and l.counts and l.played;
  if v_doubled is null and v_settled then
    select l.player_id into v_doubled from _lineup l where l.is_vice and l.counts and l.played;
  end if;

  return query
  select l.player_id, l.is_captain, l.is_vice, l.bench_order,
    (l.points * case when l.player_id = v_doubled then 2 else 1 end)::int,
    l.played, l.counts, l.sub, l.player_id is not distinct from v_doubled
  from _lineup l
  order by l.bench_order nulls first, l.player_id;
end;
$$;
revoke execute on function public.squad_lineup(uuid, int) from public, anon, authenticated;

drop function if exists public.squad_for(uuid, int);
-- Someone's squad for a gameweek (see squad_lineup). Your own squad is always
-- visible; anyone else's only after the deadline.
create or replace function public.squad_for(p_user uuid, p_gameweek int)
returns table (player_id int, is_captain boolean, is_vice boolean, bench_order smallint, points int, played boolean, counts boolean, sub text, doubled boolean)
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

-- Totals over every gameweek whose deadline has passed, with auto-subs.
create or replace function public.league_table()
returns table (user_id uuid, display_name text, team_name text, total int, latest int, rank int)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_latest int;
begin
  select id into v_latest from public.gameweeks where deadline <= now() order by start_date desc limit 1;
  return query
  with scored as (
    select pr.id as uid, g.id as gw,
      (select coalesce(sum(l.points), 0) from public.squad_lineup(pr.id, g.id) l where l.counts) as pts
    from public.profiles pr
    cross join public.gameweeks g
    where g.deadline <= now()
  ),
  totals as (
    select pr.id, pr.display_name, pr.team_name,
      coalesce(sum(s.pts), 0)::int as total,
      coalesce(sum(s.pts) filter (where s.gw = v_latest), 0)::int as latest
    from public.profiles pr
    left join scored s on s.uid = pr.id
    group by pr.id, pr.display_name, pr.team_name
  )
  select t.id, t.display_name, t.team_name, t.total, t.latest,
    (row_number() over (order by t.total desc, t.latest desc, lower(t.team_name)))::int
  from totals t
  order by 6;
end;
$$;
