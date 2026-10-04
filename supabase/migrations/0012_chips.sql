-- Chips, as in FPL: once-a-season boosts played before a gameweek's deadline.
--
--   triple_captain  Your captain (or vice, if the captain didn't play) scores 3x.
--   rolling_subs    All 15 players score, subs included (no auto-subs needed).
--   wildcard        Unlimited free transfers this gameweek; the squad stays.
--                   Two a season: one in Jul-Dec, one in Jan-Jun.
--   team_bus        Pick a Felixstowe side: points your players earn playing
--                   for that side this gameweek count double (captain too).
--
-- One chip per gameweek. Played and cancelled until the deadline, except a
-- wildcard, which can't be taken back once played. Others see chips once the
-- deadline passes.
--
-- Run 0011_bench.sql first. Safe to re-run. Replaces save_squad (same
-- arguments), squad_lineup and squad_for (new bus_points column).

create table if not exists public.chips_played (
  user_id uuid not null references public.profiles (id) on delete cascade,
  gameweek_id int not null references public.gameweeks (id) on delete cascade,
  chip text not null check (chip in ('triple_captain', 'rolling_subs', 'wildcard', 'team_bus')),
  side_id int references public.sides (id),
  played_at timestamptz not null default now(),
  primary key (user_id, gameweek_id),
  check ((chip = 'team_bus') = (side_id is not null))
);
alter table public.chips_played enable row level security;
drop policy if exists chips_played_read on public.chips_played;
create policy chips_played_read on public.chips_played for select using (
  user_id = auth.uid()
  or exists (select 1 from public.gameweeks g where g.id = gameweek_id and g.deadline <= now())
);
revoke insert, update, delete on public.chips_played from anon, authenticated;

-- Which half of the season a gameweek is in, for wildcards.
create or replace function public.season_half(p_date date)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when extract(month from p_date) >= 7 then 1 else 2 end;
$$;

-- Play a chip for the next gameweek (replacing a different chip played for
-- it, unless that was a wildcard).
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
        and public.season_half(g.start_date) = public.season_half(v_gw.start_date)
    ) then
      raise exception 'You''ve already used your wildcard for this half of the season.';
    end if;
  elsif exists (
    select 1 from public.chips_played c
    where c.user_id = v_user and c.chip = p_chip and c.gameweek_id <> v_gw.id
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

-- Take back the chip played for the next gameweek (not a wildcard).
create or replace function public.cancel_chip()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_gw public.gameweeks;
begin
  select * into v_gw from public.gameweeks where deadline > now() order by start_date limit 1;
  if not found then
    return;
  end if;
  if exists (
    select 1 from public.chips_played
    where user_id = v_user and gameweek_id = v_gw.id and chip = 'wildcard'
  ) then
    raise exception 'A wildcard can''t be taken back once played.';
  end if;
  delete from public.chips_played where user_id = v_user and gameweek_id = v_gw.id;
end;
$$;
revoke execute on function public.cancel_chip() from public, anon;
grant execute on function public.cancel_chip() to authenticated;

-- ---------------------------------------------------------------------------
-- Wildcard: as in 0011_bench.sql, without the transfer limit.
-- ---------------------------------------------------------------------------

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
  v_wildcard boolean;
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
      v_wildcard := exists (
        select 1 from public.chips_played c
        where c.user_id = v_user and c.gameweek_id = v_gw.id and c.chip = 'wildcard'
      );
      if v_transfers > v_settings.transfers_per_gameweek and not v_wildcard then
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
-- Scoring with chips: as in 0011_bench.sql, plus Rolling Subs, Triple
-- Captain and Team Bus.
-- ---------------------------------------------------------------------------

drop function if exists public.squad_for(uuid, int);
drop function if exists public.squad_lineup(uuid, int);

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
        pf.player_of_match, f.goals_for, f.goals_against
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
revoke execute on function public.squad_lineup(uuid, int) from public, anon, authenticated;

-- Someone's squad for a gameweek (see squad_lineup). Your own squad is always
-- visible; anyone else's only after the deadline.
create or replace function public.squad_for(p_user uuid, p_gameweek int)
returns table (player_id int, is_captain boolean, is_vice boolean, bench_order smallint, points int, played boolean, counts boolean, sub text, doubled boolean, bus_points int)
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
