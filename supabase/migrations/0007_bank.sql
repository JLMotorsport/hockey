-- A bank, so rising prices help and falling prices hurt.
--
-- Before: every save checked the whole squad at today's prices against the
-- 100.0m budget, so a squad whose players rose got squeezed. Now, as in the
-- Premier League game: the first squad costs what it costs and the rest of
-- the budget is the bank. Selling a player adds their current price to the
-- bank, buying one takes theirs away, so spending power is the bank plus the
-- squad's current value.
--
-- Safe to re-run. Replaces save_squad from 0005_formations.sql.

create table if not exists public.squad_banks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  gameweek_id int not null references public.gameweeks (id) on delete cascade,
  bank int not null,
  primary key (user_id, gameweek_id)
);
alter table public.squad_banks enable row level security;
drop policy if exists squad_banks_read on public.squad_banks;
create policy squad_banks_read on public.squad_banks for select using (
  user_id = auth.uid()
  or public.is_admin()
  or exists (select 1 from public.gameweeks g where g.id = gameweek_id and g.deadline <= now())
);
revoke insert, update, delete on public.squad_banks from anon, authenticated;

-- What the caller has in the bank going into the next open gameweek (before
-- this week's transfers), for the squad picker's live total.
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
  if v_user is null or v_gw.id is null then
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
  v_transfers int;
  v_shape text;
  v_base int;
  v_bank int;
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
  v_shape := format(
    '%s-%s-%s',
    (select count(*) from public.players where id = any (v_ids) and position = 'DEF'),
    (select count(*) from public.players where id = any (v_ids) and position = 'MID'),
    (select count(*) from public.players where id = any (v_ids) and position = 'FWD')
  );
  -- A squad saved before a formation was switched off can stay as it is.
  if cardinality(v_ids) = v_settings.squad_size and not (v_shape = any (v_settings.formations))
     and not (v_ids <@ v_current and v_current <@ v_ids) then
    v_errors := array_append(v_errors, format(
      'That''s a %s. Pick one of: %s.', v_shape, array_to_string(v_settings.formations, ', ')
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

  -- The bank: what's left after buying players at their price on the day,
  -- topped up by selling players at today's price. Worked out from the squad
  -- going into this gameweek, so saving twice before a deadline doesn't
  -- count a sale twice.
  if v_prev_gw is not null and cardinality(coalesce(v_previous, '{}')) > 0 then
    select bank into v_base from public.squad_banks
    where user_id = v_user and gameweek_id = public.squad_source_gameweek(v_user, v_prev_gw);
    if v_base is null then
      -- Squads saved before the bank existed.
      v_base := greatest(0, v_settings.budget - (select coalesce(sum(price), 0) from public.players where id = any (v_previous)));
    end if;
  else
    v_previous := '{}';
    v_base := v_settings.budget;
  end if;
  v_bank := v_base
    + (select coalesce(sum(price), 0) from public.players where id = any (v_previous) and not (id = any (v_ids)))
    - (select coalesce(sum(price), 0) from public.players where id = any (v_ids) and not (id = any (v_previous)));
  if v_bank < 0 then
    v_errors := array_append(v_errors, format(
      'That''s %sm more than you can spend (%sm in the bank plus the players you sell).',
      to_char(-v_bank / 10.0, 'FM990.0'),
      to_char((v_bank + (select coalesce(sum(price), 0) from public.players where id = any (v_ids) and not (id = any (v_previous)))) / 10.0, 'FM9990.0')
    ));
  end if;

  if cardinality(v_errors) > 0 then
    raise exception '%', array_to_string(v_errors, E'\n');
  end if;

  insert into public.squad_banks (user_id, gameweek_id, bank) values (v_user, v_gw.id, v_bank)
  on conflict (user_id, gameweek_id) do update set bank = excluded.bank;
  delete from public.picks where user_id = v_user and gameweek_id = v_gw.id;
  insert into public.picks (user_id, gameweek_id, player_id, is_captain)
  select v_user, v_gw.id, i, i = p_captain_id from unnest(v_ids) i;
  return v_gw.id;
end;
$$;
