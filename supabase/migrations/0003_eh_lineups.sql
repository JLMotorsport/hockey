-- Line-ups, goals and cards from England Hockey's per-match feed.
--
-- Each played Felixstowe fixture has a match page on England Hockey listing
-- who played (with a stable member id), goal scorers and cards. The eh-sync
-- function reads it and calls import_lineup(). Assists, player of the match
-- and outfield positions are not published, so managers still add those.
--
-- Safe to re-run.

alter table public.players add column if not exists eh_member_id text;
-- Created automatically from a line-up and still needs a position and price
-- from a manager. Such players stay inactive (unpickable) until reviewed.
alter table public.players add column if not exists needs_review boolean not null default false;
create unique index if not exists players_eh_member_id_key on public.players (eh_member_id);

-- Set when a manager edits a match's stats so the sync stops replacing them.
alter table public.fixtures add column if not exists stats_overridden boolean not null default false;
alter table public.fixtures add column if not exists lineup_imported_at timestamptz;

-- Editing stats by hand now also takes the match off the automatic import.
-- Body otherwise as in 0002_game.sql.
create or replace function public.save_match_stats(
  p_fixture_id int,
  p_goals_for int,
  p_goals_against int,
  p_stats jsonb,
  p_complete boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.fixtures;
  v_player_ids int[];
begin
  perform public.require_admin();
  select * into v_fixture from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  if p_goals_for is not null and p_goals_against is not null then
    if (p_goals_for, p_goals_against) is distinct from (v_fixture.goals_for, v_fixture.goals_against) then
      update public.fixtures
      set goals_for = p_goals_for, goals_against = p_goals_against, score_overridden = true
      where id = p_fixture_id;
    end if;
  elsif p_goals_for is null and p_goals_against is null and v_fixture.score_overridden then
    update public.fixtures set score_overridden = false where id = p_fixture_id;
  end if;

  v_player_ids := array(select (s ->> 'player_id')::int from jsonb_array_elements(coalesce(p_stats, '[]')) s);
  delete from public.performances
  where fixture_id = p_fixture_id and not (player_id = any (v_player_ids));

  insert into public.performances (
    fixture_id, player_id, goals, assists, green_cards, yellow_cards, red_cards, player_of_match
  )
  select
    p_fixture_id,
    (s ->> 'player_id')::int,
    coalesce((s ->> 'goals')::int, 0),
    coalesce((s ->> 'assists')::int, 0),
    coalesce((s ->> 'green_cards')::int, 0),
    coalesce((s ->> 'yellow_cards')::int, 0),
    coalesce((s ->> 'red_cards')::int, 0),
    coalesce((s ->> 'player_of_match')::boolean, false)
  from jsonb_array_elements(coalesce(p_stats, '[]')) s
  on conflict (player_id, fixture_id) do update set
    goals = excluded.goals,
    assists = excluded.assists,
    green_cards = excluded.green_cards,
    yellow_cards = excluded.yellow_cards,
    red_cards = excluded.red_cards,
    player_of_match = excluded.player_of_match;

  update public.fixtures
  set stats_complete = coalesce(p_complete, false), stats_overridden = true
  where id = p_fixture_id;
end;
$$;

-- Hand a match's stats back to England Hockey; the next sync re-imports them.
create or replace function public.use_eh_stats(p_fixture_id int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.fixtures set stats_overridden = false, lineup_imported_at = null where id = p_fixture_id;
end;
$$;

-- Import one fixture's line-up. p_players: [{member_id, name, is_gk, goals,
-- green_cards, yellow_cards, red_cards}] for the Felixstowe side only.
-- Called by the eh-sync Edge Function with the service role.
create or replace function public.import_lineup(p_fixture_id int, p_players jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.fixtures;
  v_player_id int;
  v_created int := 0;
  v_rows int := 0;
  r jsonb;
begin
  select * into v_fixture from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture % not found', p_fixture_id;
  end if;
  if v_fixture.stats_overridden then
    return jsonb_build_object('skipped', true);
  end if;
  -- No line-up entered on England Hockey yet: leave things alone and let the
  -- next sync try again.
  if jsonb_array_length(coalesce(p_players, '[]')) = 0 then
    return jsonb_build_object('created', 0, 'players', 0);
  end if;

  delete from public.performances where fixture_id = p_fixture_id;

  for r in select * from jsonb_array_elements(coalesce(p_players, '[]'))
  loop
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

    insert into public.performances (fixture_id, player_id, goals, green_cards, yellow_cards, red_cards)
    values (
      p_fixture_id,
      v_player_id,
      least(coalesce((r ->> 'goals')::int, 0), 20),
      least(coalesce((r ->> 'green_cards')::int, 0), 5),
      least(coalesce((r ->> 'yellow_cards')::int, 0), 5),
      least(coalesce((r ->> 'red_cards')::int, 0), 1)
    )
    on conflict (player_id, fixture_id) do nothing;
    v_rows := v_rows + 1;
  end loop;

  update public.fixtures
  set lineup_imported_at = now(), stats_complete = true
  where id = p_fixture_id;
  return jsonb_build_object('created', v_created, 'players', v_rows);
end;
$$;
revoke execute on function public.import_lineup(int, jsonb) from public, anon, authenticated;
grant execute on function public.import_lineup(int, jsonb) to service_role;
