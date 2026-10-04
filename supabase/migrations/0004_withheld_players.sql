-- Players whose name is withheld on England Hockey.
--
-- Their GMS profile is private, so the match feed shows "Name Withheld", but
-- it still gives each one a stable member id and a shirt number, and tags
-- their goals and cards with that id. So they are imported like everyone
-- else under a placeholder name ("Name withheld #5 (M3)"). A manager renames
-- them once; later syncs match them by member id and never touch the name.
-- If a manager had already added that person by hand, merge_players() folds
-- the placeholder into the existing player.
--
-- Safe to re-run.

alter table public.players add column if not exists name_withheld boolean not null default false;

-- Renaming a placeholder marks it as named.
create or replace function public.players_clear_withheld()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.name_withheld and new.name is distinct from old.name then
    new.name_withheld := false;
  end if;
  return new;
end;
$$;

drop trigger if exists players_clear_withheld on public.players;
create trigger players_clear_withheld
  before update of name on public.players
  for each row execute function public.players_clear_withheld();

-- p_players: [{member_id, name, withheld, shirt, is_gk, goals, green_cards,
-- yellow_cards, red_cards}] for the Felixstowe side. name is null when
-- withheld. p_withheld: listed players with no member id at all (can't be
-- matched, so they still need adding by hand).
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
          then format('Name withheld #%s (%s)', coalesce(nullif(r ->> 'shirt', ''), '?'), v_side_short)
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
    insert into public.performances (fixture_id, player_id, goals, green_cards, yellow_cards, red_cards)
    values (
      p_fixture_id,
      v_player_id,
      least(coalesce((r ->> 'goals')::int, 0), 20),
      least(coalesce((r ->> 'green_cards')::int, 0), 5),
      least(coalesce((r ->> 'yellow_cards')::int, 0), 5),
      least(coalesce((r ->> 'red_cards')::int, 0), 1)
    )
    on conflict (player_id, fixture_id) do update set
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

-- Fold one player into another: the England Hockey link, match stats and
-- fantasy picks move across, then the first player is deleted. Used when a
-- withheld placeholder turns out to be someone already in the list.
create or replace function public.merge_players(p_from int, p_into int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.players;
  v_into public.players;
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

  delete from public.picks f
  where f.player_id = p_from
    and exists (
      select 1 from public.picks t
      where t.player_id = p_into and t.user_id = f.user_id and t.gameweek_id = f.gameweek_id
    );
  update public.picks set player_id = p_into where player_id = p_from;

  delete from public.players where id = p_from;
  update public.players
  set eh_member_id = coalesce(v_into.eh_member_id, v_from.eh_member_id)
  where id = p_into;
end;
$$;

-- Re-read line-ups that had withheld players so they get imported on the
-- next sync, whatever their age. Manual entries are kept by import_lineup.
update public.fixtures set lineup_imported_at = null where withheld_count > 0;
