-- Set formations. A squad must line up in one of the formations the league
-- allows (defenders-midfielders-forwards, always 1 goalkeeper), chosen by the
-- manager in Settings. Replaces the old "at least 3/3/1" rule in save_squad.
--
-- Safe to re-run.

alter table public.league_settings
  add column if not exists formations text[] not null
  default array['4-4-2', '4-3-3', '3-4-3', '3-5-2', '5-3-2', '4-5-1', '5-4-1'];

alter table public.league_settings drop constraint if exists league_settings_formations_check;
alter table public.league_settings add constraint league_settings_formations_check check (
  cardinality(formations) > 0
  and formations <@ array['4-4-2', '4-3-3', '3-4-3', '3-5-2', '5-3-2', '4-5-1', '5-4-1', '3-3-4', '4-2-4', '5-2-3', '3-6-1', '6-3-1']
);

-- As in 0002_game.sql, with the formation check in place of the minimums.
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
  v_shape text;
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
