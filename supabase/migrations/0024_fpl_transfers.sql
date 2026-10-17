-- FPL-style transfers, and two undo safety fixes.
--
-- Transfers: each gameweek you get transfers_per_gameweek free transfers.
-- Unused ones carry over, up to max_free_transfers banked. Every transfer
-- past your free ones is allowed but costs transfer_hit points off that
-- gameweek's score. Free (and not counted): your first squad, a wildcard
-- week, the late entry week, and fixing a squad that doesn't fit 2/5/5/3.
-- Hits apply from the gameweek after scoring restarted (0021).
--
-- Undo: an added player, fixture, gameweek or side can't be undone while
-- something now depends on it, and deleting a player or fixture keeps the
-- price history and Pitchero line-up it took with it, so undo puts those
-- back too.
--
-- Safe to re-run.

alter table public.league_settings add column if not exists transfer_hit int not null default 4;
alter table public.league_settings add column if not exists max_free_transfers int not null default 5;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'league_settings_transfer_hit_check') then
    alter table public.league_settings
      add constraint league_settings_transfer_hit_check check (transfer_hit >= 0);
  end if;
end;
$$;

-- Transfers made for a gameweek: new players in its squad against the squad
-- going into it. 0 when they didn't save that week or the week is free.
create or replace function public.transfers_used(p_user uuid, p_gameweek int)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prev_gw int;
  v_prev_src int;
  v_previous int[];
  v_ids int[];
begin
  if public.squad_source_gameweek(p_user, p_gameweek) is distinct from p_gameweek then
    return 0;
  end if;
  select id into v_prev_gw from public.gameweeks
  where start_date < (select start_date from public.gameweeks where id = p_gameweek)
  order by start_date desc limit 1;
  v_prev_src := case when v_prev_gw is not null then public.squad_source_gameweek(p_user, v_prev_gw) end;
  if v_prev_src is null then
    return 0; -- first squad
  end if;
  if exists (
    select 1 from public.chips_played c
    where c.user_id = p_user and c.gameweek_id = p_gameweek and c.chip = 'wildcard'
  ) then
    return 0;
  end if;
  if (select late_entry_gameweek from public.profiles where id = p_user) is not distinct from p_gameweek then
    return 0;
  end if;
  v_previous := array(select player_id from public.picks where user_id = p_user and gameweek_id = v_prev_src);
  if not public.squad_fits_quota(v_previous) then
    return 0;
  end if;
  v_ids := array(select player_id from public.picks where user_id = p_user and gameweek_id = p_gameweek);
  return greatest(0,
    (select count(*) from unnest(v_ids) x where not (x = any (v_previous)))::int
    - greatest(0, 15 - cardinality(v_previous)));
end;
$$;
revoke execute on function public.transfers_used(uuid, int) from public, anon, authenticated;

-- Free transfers going into a gameweek: the weekly allowance plus what was
-- banked, counted from the gameweek scoring restarted.
create or replace function public.free_transfers(p_user uuid, p_gameweek int)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.league_settings;
  v_free int;
  v_prev int;
  g record;
begin
  select * into v_settings from public.league_settings where id = 1;
  v_free := v_settings.transfers_per_gameweek;
  for g in
    select id from public.gameweeks
    where start_date >= coalesce(v_settings.scoring_from, '-infinity'::date)
      and start_date < (select start_date from public.gameweeks where id = p_gameweek)
    order by start_date
  loop
    if public.squad_source_gameweek(p_user, g.id) is null then
      v_free := v_settings.transfers_per_gameweek; -- not playing yet
    else
      v_prev := (
        select x.id from public.gameweeks x
        where x.start_date < (select start_date from public.gameweeks where id = g.id)
        order by x.start_date desc limit 1
      );
      if v_prev is null or public.squad_source_gameweek(p_user, v_prev) is null then
        v_free := v_settings.transfers_per_gameweek; -- first squad: nothing banked
      else
        v_free := least(
          greatest(v_settings.max_free_transfers, v_settings.transfers_per_gameweek),
          greatest(0, v_free - public.transfers_used(p_user, g.id)) + v_settings.transfers_per_gameweek
        );
      end if;
    end if;
  end loop;
  return v_free;
end;
$$;
revoke execute on function public.free_transfers(uuid, int) from public, anon, authenticated;

-- Points off a gameweek for transfers past the free ones.
create or replace function public.transfer_hit(p_user uuid, p_gameweek int)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.league_settings;
  v_used int;
begin
  select * into v_settings from public.league_settings where id = 1;
  if v_settings.scoring_from is not null
     and (select start_date from public.gameweeks where id = p_gameweek) <= v_settings.scoring_from then
    return 0;
  end if;
  v_used := public.transfers_used(p_user, p_gameweek);
  if v_used = 0 then
    return 0;
  end if;
  return greatest(0, v_used - public.free_transfers(p_user, p_gameweek)) * v_settings.transfer_hit;
end;
$$;
revoke execute on function public.transfer_hit(uuid, int) from public, anon, authenticated;

-- For the app: transfers made, free transfers going in, and the hit, for
-- one manager and gameweek. Someone else's only once the deadline's gone.
create or replace function public.transfer_summary(p_user uuid, p_gameweek int)
returns table (used int, free int, hit int)
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
  return query select public.transfers_used(p_user, p_gameweek), public.free_transfers(p_user, p_gameweek),
    public.transfer_hit(p_user, p_gameweek);
end;
$$;
revoke execute on function public.transfer_summary(uuid, int) from public, anon;
grant execute on function public.transfer_summary(uuid, int) to authenticated;

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
-- The league table: each gameweek's points less its transfer hit.
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
      (select coalesce(sum(l.points), 0) from public.squad_lineup(pr.id, g.id) l where l.counts)::int
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

-- Changing the hit or the allowance changes past scores.
drop trigger if exists league_cache_settings on public.league_settings;
create trigger league_cache_settings after update on public.league_settings
  for each statement execute function public.league_cache_bump();
-- Moving someone's position can turn a week's transfers into a free fix.
update public.league_cache_state set version = version + 1 where id = 1;

-- --- Undo safety ---------------------------------------------------------------

-- Deleting a player or fixture also deletes its price history or Pitchero
-- line-up, which aren't logged row by row. Keep a copy in the log so undo
-- can put them back.
create or replace function public.log_cascaded_children()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null or not public.is_admin()
     or coalesce(current_setting('fhc.undoing', true), '') = 'on' then
    return old;
  end if;
  if tg_table_name = 'fixtures' then
    select jsonb_agg(to_jsonb(p)) into v_rows from public.pitchero_lineups p where p.fixture_id = old.id;
    if v_rows is not null then
      insert into public.manager_log (actor, table_name, op, row_id, old_data)
      values (auth.uid(), 'pitchero_lineups', 'delete', old.id::text, jsonb_build_object('rows', v_rows));
    end if;
  elsif tg_table_name = 'players' then
    select jsonb_agg(to_jsonb(p)) into v_rows from public.price_changes p where p.player_id = old.id;
    if v_rows is not null then
      insert into public.manager_log (actor, table_name, op, row_id, old_data)
      values (auth.uid(), 'price_changes', 'delete', old.id::text, jsonb_build_object('rows', v_rows));
    end if;
  end if;
  return old;
end;
$$;
drop trigger if exists fixtures_log_children on public.fixtures;
create trigger fixtures_log_children before delete on public.fixtures
  for each row execute function public.log_cascaded_children();
drop trigger if exists players_log_children on public.players;
create trigger players_log_children before delete on public.players
  for each row execute function public.log_cascaded_children();

create or replace function public.undo_change(p_id bigint)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx bigint;
  v_cur jsonb;
  v_cols text[];
  v_list text;
  v_dep boolean;
  c text;
  n int := 0;
  r public.manager_log;
  fk record;
begin
  if not public.is_super() then
    raise exception 'Only the super user can undo changes.';
  end if;
  select tx into v_tx from public.manager_log where id = p_id;
  if not found then
    raise exception 'That change isn''t in the log.';
  end if;
  if exists (select 1 from public.manager_log where tx = v_tx and undone_at is not null) then
    raise exception 'That change has already been undone.';
  end if;
  if exists (select 1 from public.manager_log where tx = v_tx and table_name = 'accounts') then
    raise exception 'Removing an account can''t be undone.';
  end if;
  perform set_config('fhc.undoing', 'on', true);

  -- Newest first; rows the action deleted go back last, parents before children.
  for r in
    select * from public.manager_log where tx = v_tx
    order by (op = 'delete'),
      case when op = 'delete' then array_position(
        array['sides', 'gameweeks', 'players', 'league_settings', 'profiles', 'fixtures', 'performances',
              'pitchero_lineups', 'price_changes'], table_name)
      end,
      id desc
  loop
    -- A deleted player's price history or fixture's Pitchero line-up, kept whole.
    if r.table_name in ('pitchero_lineups', 'price_changes') then
      execute format(
        'insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1) on conflict do nothing',
        r.table_name, r.table_name
      ) using r.old_data -> 'rows';
      n := n + 1;
      continue;
    end if;

    execute format('select to_jsonb(t) from public.%I t where t.id::text = $1', r.table_name)
      into v_cur using r.row_id;
    if r.op = 'insert' then
      continue when v_cur is null; -- already gone (deleted along with its parent)
      if v_cur <> r.new_data then
        raise exception 'A %s added by this change has been edited since. Undo the later change first.', r.table_name;
      end if;
      -- Removing it would take other things with it (or fail): refuse.
      for fk in
        select cl.relname as rel, a.attname as col
        from pg_constraint k
        join pg_class cl on cl.oid = k.conrelid
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
        where k.contype = 'f' and k.confrelid = format('public.%I', r.table_name)::regclass
          and cl.relnamespace = 'public'::regnamespace
          and cl.relname <> 'manager_log'
      loop
        execute format('select exists (select 1 from public.%I where %I::text = $1)', fk.rel, fk.col)
          into v_dep using r.row_id;
        if v_dep then
          raise exception 'Can''t undo: the %s added by this change is now used in %s. Remove those first.',
            rtrim(r.table_name, 's'),
            case fk.rel
              when 'performances' then 'match stats'
              when 'picks' then 'people''s squads'
              when 'price_changes' then 'its price history'
              when 'pitchero_lineups' then 'a Pitchero line-up'
              when 'chips_played' then 'chips people have played'
              when 'squad_banks' then 'people''s squads'
              when 'profiles' then 'people''s teams'
              else replace(fk.rel, '_', ' ')
            end;
        end if;
      end loop;
      execute format('delete from public.%I where id::text = $1', r.table_name) using r.row_id;
    elsif r.op = 'delete' then
      if v_cur is not null then
        raise exception 'A %s removed by this change is back again. Undo the later change first.', r.table_name;
      end if;
      execute format(
        'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', r.table_name, r.table_name
      ) using r.old_data;
    else
      if v_cur is null then
        raise exception 'A %s changed by this has been deleted since. Undo the later change first.', r.table_name;
      end if;
      v_cols := array(
        select key from jsonb_each(r.new_data) where r.old_data -> key is distinct from value
      );
      foreach c in array v_cols loop
        if v_cur -> c is distinct from r.new_data -> c then
          raise exception 'A %s changed by this has been edited again since. Undo the later change first.', r.table_name;
        end if;
      end loop;
      if cardinality(v_cols) > 0 then
        select string_agg(format('%I', x), ', ') into v_list from unnest(v_cols) x;
        execute format(
          'update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where t.id::text = $2',
          r.table_name, v_list, v_list, r.table_name
        ) using r.old_data, r.row_id;
      end if;
    end if;
    n := n + 1;
  end loop;

  update public.manager_log set undone_at = now(), undone_by = auth.uid() where tx = v_tx;
  return n;
end;
$$;
revoke execute on function public.undo_change(bigint) from public, anon;
grant execute on function public.undo_change(bigint) to authenticated;
