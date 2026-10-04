-- Line-ups, goals and cards from England Hockey's per-match feed.
--
-- Each played Felixstowe fixture has a match page on England Hockey listing
-- who played (with a stable member id), goal scorers and cards. The eh-sync
-- function reads it and calls import_lineup().
--
-- England Hockey owns goals and cards for the named players it lists. Managers
-- own everything else: player of the match, assists, and players whose names
-- are withheld on England Hockey (added by hand). The sync never touches those,
-- so the two work side by side. A manager can lock a match to stop the sync
-- changing it at all, e.g. to correct a mistake on England Hockey.
--
-- Safe to re-run.

alter table public.players add column if not exists eh_member_id text;
-- Created automatically from a line-up and still needs a position and price
-- from a manager. Such players stay inactive (unpickable) until reviewed.
alter table public.players add column if not exists needs_review boolean not null default false;
create unique index if not exists players_eh_member_id_key on public.players (eh_member_id);

alter table public.fixtures add column if not exists stats_locked boolean not null default false;
alter table public.fixtures add column if not exists lineup_imported_at timestamptz;
-- Players in the England Hockey line-up whose names are withheld: they need
-- adding by hand, so the overview can say which matches are short.
alter table public.fixtures add column if not exists withheld_count int not null default 0;

create or replace function public.set_stats_lock(p_fixture_id int, p_locked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.fixtures set stats_locked = coalesce(p_locked, false) where id = p_fixture_id;
end;
$$;

-- Import one fixture's line-up for the Felixstowe side.
-- p_players: [{member_id, name, is_gk, goals, green_cards, yellow_cards, red_cards}]
-- p_withheld: how many listed players had their name withheld.
-- Called by the eh-sync Edge Function with the service role.
create or replace function public.import_lineup(p_fixture_id int, p_players jsonb, p_withheld int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.fixtures;
  v_player_id int;
  v_ids int[] := '{}';
  v_created int := 0;
  r jsonb;
begin
  select * into v_fixture from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture % not found', p_fixture_id;
  end if;
  if v_fixture.stats_locked then
    return jsonb_build_object('skipped', true);
  end if;
  -- No line-up entered on England Hockey yet: leave things alone and let the
  -- next sync try again.
  if jsonb_array_length(coalesce(p_players, '[]')) = 0 then
    return jsonb_build_object('created', 0, 'players', 0);
  end if;

  for r in select * from jsonb_array_elements(p_players)
  loop
    v_player_id := null;
    select id into v_player_id from public.players where eh_member_id = r ->> 'member_id';

    -- A manager may have added this player by hand before the first sync:
    -- link them by name rather than creating a duplicate.
    if v_player_id is null then
      select id into v_player_id from public.players
      where eh_member_id is null and lower(trim(name)) = lower(trim(r ->> 'name'))
      order by (side_id = v_fixture.side_id) desc, id
      limit 1;
      if v_player_id is not null then
        update public.players set eh_member_id = r ->> 'member_id' where id = v_player_id;
      end if;
    end if;

    if v_player_id is null then
      insert into public.players (name, position, side_id, price, active, eh_member_id, needs_review)
      values (
        left(r ->> 'name', 120),
        case when (r ->> 'is_gk')::boolean then 'GK' else 'MID' end,
        v_fixture.side_id,
        50,
        false,
        r ->> 'member_id',
        true
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
  -- no England Hockey id (withheld names, added by hand) are never touched.
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
    -- Complete when nobody is missing; otherwise a manager ticks it once the
    -- withheld players are added.
    stats_complete = stats_complete or coalesce(p_withheld, 0) = 0
  where id = p_fixture_id;
  return jsonb_build_object('created', v_created, 'players', cardinality(v_ids));
end;
$$;
revoke execute on function public.import_lineup(int, jsonb, int) from public, anon, authenticated;
grant execute on function public.import_lineup(int, jsonb, int) to service_role;
