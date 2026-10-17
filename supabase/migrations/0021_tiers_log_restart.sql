-- 0021: three tiers of user, a log of managers' changes with undo, scoring
-- restarted from this gameweek, and late entry for today's new teams.
--
-- Safe to run again: everything is if not exists / create or replace, and the
-- restart date and late-entry close are only set the first time.
--
-- After running this, make yourself the super user (your own login email):
--   update public.profiles set is_super = true, is_admin = true
--   where id = (select id from auth.users where email = 'YOUR EMAIL');

-- ---------------------------------------------------------------------------
-- 1. Super user: everything a manager can do, plus appointing managers and
--    the change log. Only set by hand (above); nobody can grant it in the app.
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists is_super boolean not null default false;

create or replace function public.is_super()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_super from public.profiles where id = auth.uid()), false);
$$;

-- The super user is always a manager.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_admin or is_super from public.profiles where id = auth.uid()), false);
$$;

-- Only the super user makes or removes managers, and can't be removed.
create or replace function public.set_admin(p_user uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super() then
    raise exception 'Only the super user can make or remove managers.';
  end if;
  if p_user = auth.uid() then
    raise exception 'You can''t change your own manager access.';
  end if;
  if exists (select 1 from public.profiles where id = p_user and is_super) then
    raise exception 'The super user is always a manager.';
  end if;
  update public.profiles set is_admin = p_value where id = p_user;
end;
$$;

drop function if exists public.admin_users();
create function public.admin_users()
returns table (id uuid, email text, display_name text, team_name text, is_admin boolean, is_super boolean, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select p.id, u.email::text, p.display_name, p.team_name, p.is_admin or p.is_super, p.is_super, p.created_at
  from public.profiles p join auth.users u on u.id = p.id
  order by lower(p.display_name);
end;
$$;
revoke execute on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The change log: every change a manager makes, kept for the super user
--    to read and undo. England Hockey syncs (no logged-in user) aren't logged.
-- ---------------------------------------------------------------------------

create table if not exists public.manager_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- One action (saving a match, deleting a fixture) is one transaction.
  tx bigint not null default txid_current(),
  actor uuid references public.profiles (id) on delete set null,
  table_name text not null,
  op text not null check (op in ('insert', 'update', 'delete')),
  row_id text not null,
  old_data jsonb,
  new_data jsonb,
  undone_at timestamptz,
  undone_by uuid references public.profiles (id) on delete set null
);
create index if not exists manager_log_at_idx on public.manager_log (at desc);
create index if not exists manager_log_tx_idx on public.manager_log (tx);

alter table public.manager_log enable row level security;
revoke all on public.manager_log from anon, authenticated;
grant select on public.manager_log to authenticated;
drop policy if exists manager_log_super_read on public.manager_log;
create policy manager_log_super_read on public.manager_log
  for select to authenticated
  using (public.is_super());

create or replace function public.log_manager_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  -- Undoing writes the log itself (undone_at), so its writes aren't new changes.
  if auth.uid() is null or not public.is_admin()
     or coalesce(current_setting('fhc.undoing', true), '') = 'on' then
    return null;
  end if;
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and v_old = v_new then
    return null;
  end if;
  insert into public.manager_log (actor, table_name, op, row_id, old_data, new_data)
  values (auth.uid(), tg_table_name, lower(tg_op), coalesce(v_new, v_old)->>'id', v_old, v_new);
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['sides', 'players', 'gameweeks', 'fixtures', 'performances', 'league_settings']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_manager_log', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.log_manager_change()',
      t || '_manager_log', t
    );
  end loop;
end;
$$;
-- Profiles: only who is a manager (not people changing their own team name).
drop trigger if exists profiles_manager_log on public.profiles;
create trigger profiles_manager_log after update of is_admin on public.profiles
  for each row execute function public.log_manager_change();

-- Undo one whole action. Refuses if anything it touched has changed since,
-- so a later edit is never silently overwritten.
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
  c text;
  n int := 0;
  r public.manager_log;
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
  perform set_config('fhc.undoing', 'on', true);

  -- Newest first; rows the action deleted go back last, parents before children.
  for r in
    select * from public.manager_log where tx = v_tx
    order by (op = 'delete'),
      case when op = 'delete' then array_position(
        array['sides', 'gameweeks', 'players', 'league_settings', 'profiles', 'fixtures', 'performances'], table_name)
      end,
      id desc
  loop
    execute format('select to_jsonb(t) from public.%I t where t.id::text = $1', r.table_name)
      into v_cur using r.row_id;
    if r.op = 'insert' then
      continue when v_cur is null; -- already gone (deleted along with its parent)
      if v_cur <> r.new_data then
        raise exception 'A %s added by this change has been edited since. Undo the later change first.', r.table_name;
      end if;
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

-- ---------------------------------------------------------------------------
-- 3. Scoring restarts from this gameweek, and today's new teams can enter it
-- ---------------------------------------------------------------------------

alter table public.league_settings add column if not exists scoring_from date;
alter table public.league_settings add column if not exists late_entry_until timestamptz;
alter table public.profiles add column if not exists late_entry_gameweek int
  references public.gameweeks (id) on delete set null;

-- Set once: the gameweek live now (its deadline passed most recently), and
-- late entry open until midnight tonight, UK time.
update public.league_settings s
set scoring_from = coalesce(s.scoring_from, g.start_date),
    late_entry_until = coalesce(s.late_entry_until,
      (((now() at time zone 'Europe/London')::date + 1)::timestamp at time zone 'Europe/London'))
from (select start_date from public.gameweeks where deadline <= now() order by start_date desc limit 1) g
where s.id = 1;

-- Chips played before the restart are given back.
delete from public.chips_played c
using public.gameweeks g, public.league_settings s
where g.id = c.gameweek_id and s.id = 1 and g.start_date < s.scoring_from;

-- Is this person in late entry? While it's open, someone with no squad
-- from before the live gameweek's deadline picks their first squad for it,
-- free (full budget, no transfer limit), until late entry closes.
create or replace function public.in_late_entry()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.league_settings s,
      (select id, start_date from public.gameweeks where deadline <= now() order by start_date desc limit 1) v
    where s.id = 1
      and now() < s.late_entry_until
      and (
        (select late_entry_gameweek from public.profiles where id = auth.uid()) is not distinct from v.id
        or not exists (
          select 1 from public.picks p join public.gameweeks g on g.id = p.gameweek_id
          where p.user_id = auth.uid() and g.start_date <= v.start_date
        )
      )
  );
$$;
revoke execute on function public.in_late_entry() from public, anon;
grant execute on function public.in_late_entry() to authenticated;

-- One squad (picks and bank) copied to another gameweek.
create or replace function public.copy_squad(p_user uuid, p_from int, p_to int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.picks where user_id = p_user and gameweek_id = p_to;
  insert into public.picks (user_id, gameweek_id, player_id, is_captain, is_vice, bench_order)
  select user_id, p_to, player_id, is_captain, is_vice, bench_order
  from public.picks where user_id = p_user and gameweek_id = p_from;
  insert into public.squad_banks (user_id, gameweek_id, bank)
  select user_id, p_to, bank from public.squad_banks where user_id = p_user and gameweek_id = p_from
  on conflict (user_id, gameweek_id) do update set bank = excluded.bank;
end;
$$;
revoke execute on function public.copy_squad(uuid, int, int) from public, anon, authenticated;

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
  v_free_fix boolean := false;
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

  -- Transfers count against the squad going into this gameweek. A squad
  -- from before the bench existed may add players up to 15 for free.
  select id into v_prev_gw from public.gameweeks
  where start_date < v_gw.start_date order by start_date desc limit 1;
  if v_prev_gw is not null and not v_late then
    v_previous := array(
      select player_id from public.picks
      where user_id = v_user and gameweek_id = public.squad_source_gameweek(v_user, v_prev_gw)
    );
    if cardinality(v_previous) > 0 then
      v_transfers := (select count(*) from unnest(v_ids) x where not (x = any (v_previous)))
        - greatest(0, 15 - cardinality(v_previous));
      -- A squad that doesn't fit 2/5/5/3 (saved before the rule, or a manager
      -- has since changed someone's position) fixes it without using transfers.
      v_free_fix := not public.squad_fits_quota(v_previous);
      v_wildcard := exists (
        select 1 from public.chips_played c
        where c.user_id = v_user and c.gameweek_id = v_gw.id and c.chip = 'wildcard'
      );
      if v_transfers > v_settings.transfers_per_gameweek and not v_wildcard and not v_free_fix then
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

  if v_late then
    perform public.copy_squad(v_user, v_gw.id, v_live.id);
    update public.profiles set late_entry_gameweek = v_live.id where id = v_user;
  end if;
  return v_gw.id;
end;
$$;

create or replace function public.bank_before_next()
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_gw public.gameweeks;
  v_prev_gw int;
  v_source int;
  v_bank int;
  v_budget int;
begin
  select budget into v_budget from public.league_settings where id = 1;
  select * into v_gw from public.gameweeks where deadline > now() order by start_date limit 1;
  -- Late entry (above): a free first squad, so the whole budget.
  if v_user is null or v_gw.id is null or public.in_late_entry() then
    return v_budget;
  end if;
  select id into v_prev_gw from public.gameweeks
  where start_date < v_gw.start_date order by start_date desc limit 1;
  v_source := case when v_prev_gw is null then null else public.squad_source_gameweek(v_user, v_prev_gw) end;
  if v_source is null then
    return v_budget;
  end if;
  select bank into v_bank from public.squad_banks where user_id = v_user and gameweek_id = v_source;
  if v_bank is null then
    v_bank := greatest(0, v_budget - (
      select coalesce(sum(pl.price), 0) from public.picks p join public.players pl on pl.id = p.player_id
      where p.user_id = v_user and p.gameweek_id = v_source
    ));
  end if;
  return v_bank;
end;
$$;

-- Teams already made today, after the live gameweek's deadline, join it now.
do $$
declare
  v_live public.gameweeks;
  r record;
begin
  select * into v_live from public.gameweeks where deadline <= now() order by start_date desc limit 1;
  if v_live.id is null
     or now() >= coalesce((select late_entry_until from public.league_settings where id = 1), '-infinity'::timestamptz) then
    return;
  end if;
  for r in
    select p.user_id, (array_agg(g.id order by g.start_date))[1] as first_gw
    from public.picks p join public.gameweeks g on g.id = p.gameweek_id
    group by p.user_id
    having min(g.start_date) > v_live.start_date
  loop
    perform public.copy_squad(r.user_id, r.first_gw, v_live.id);
    update public.profiles set late_entry_gameweek = v_live.id where id = r.user_id;
  end loop;
end;
$$;

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

-- Rebuild the table on the new rules.
update public.league_cache_state set version = version + 1 where id = 1;
