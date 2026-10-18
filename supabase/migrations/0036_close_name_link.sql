-- The sync links a player a manager added by hand (say from Pitchero) to
-- England Hockey's entry when the names differ by one letter (Denis and
-- Dennis), not only when they match exactly, so a spelling difference
-- doesn't make a duplicate. Not initials: the names must be all but the same.
-- Spaces, hyphens and capitals are ignored; short names (under 8 letters)
-- must match exactly; and it doesn't guess when two hand-added players are
-- that close. src/lib/pitcheroMatch.ts namesClose() is the same rule.
--
-- Safe to re-run.

-- Two names the same but for at most one letter added, missing or changed.
create or replace function public.names_close(p_a text, p_b text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  a text := regexp_replace(lower(coalesce(p_a, '')), '[^a-z]', '', 'g');
  b text := regexp_replace(lower(coalesce(p_b, '')), '[^a-z]', '', 'g');
  i int := 1;
begin
  if a = '' or b = '' then
    return false;
  end if;
  if a = b then
    return true;
  end if;
  if least(length(a), length(b)) < 8 or abs(length(a) - length(b)) > 1 then
    return false;
  end if;
  while i <= least(length(a), length(b)) and substr(a, i, 1) = substr(b, i, 1) loop
    i := i + 1;
  end loop;
  if length(a) = length(b) then
    return substr(a, i + 1) = substr(b, i + 1);
  elsif length(a) > length(b) then
    return substr(a, i + 1) = substr(b, i);
  else
    return substr(a, i) = substr(b, i + 1);
  end if;
end;
$$;

-- As 0026, with the close-name link.
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
  v_close int;
  v_close_n int;
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
    -- Their England Hockey id, or a second id they're also registered under (0026).
    v_player_id := public.player_for_eh(r ->> 'member_id');

    -- A named player a manager added by hand before the first sync: link by
    -- name rather than create a duplicate. (Withheld players have no name to
    -- match on; a manager merges them instead.)
    if v_player_id is null and not v_withheld then
      select id into v_player_id from public.players
      where eh_member_id is null and lower(trim(name)) = lower(trim(r ->> 'name'))
      order by (side_id = v_fixture.side_id) desc, id
      limit 1;
      -- Or a small spelling difference (Denis / Dennis), when only one
      -- hand-added player is that close (0036).
      if v_player_id is null then
        select min(id), count(*) into v_close, v_close_n from public.players
        where eh_member_id is null and not name_withheld
          and public.names_close(name, r ->> 'name');
        if v_close_n = 1 then
          v_player_id := v_close;
        end if;
      end if;
      if v_player_id is not null then
        update public.players set eh_member_id = r ->> 'member_id' where id = v_player_id;
      end if;
    end if;

    if v_player_id is null then
      insert into public.players (name, position, side_id, price, active, eh_member_id, needs_review, name_withheld)
      values (
        case when v_withheld
          -- Shirt number helps work out who it is; without one, a short id
          -- keeps two placeholders apart.
          then format('Name withheld #%s (%s)',
            coalesce(nullif(r ->> 'shirt', ''), left(r ->> 'member_id', 4)), v_side_short)
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
    insert into public.performances (fixture_id, player_id, shirt, goals, green_cards, yellow_cards, red_cards)
    values (
      p_fixture_id,
      v_player_id,
      nullif(r ->> 'shirt', ''),
      least(coalesce((r ->> 'goals')::int, 0), 20),
      least(coalesce((r ->> 'green_cards')::int, 0), 5),
      least(coalesce((r ->> 'yellow_cards')::int, 0), 5),
      least(coalesce((r ->> 'red_cards')::int, 0), 1)
    )
    on conflict (player_id, fixture_id) do update set
      shirt = excluded.shirt,
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
