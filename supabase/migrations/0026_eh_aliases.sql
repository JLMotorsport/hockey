-- One person registered twice on England Hockey (two member ids).
--
-- player_eh_aliases maps a second England Hockey id to the player kept, so
-- the sync files both ids' matches under one player instead of creating a
-- duplicate. merge_players() takes p_same_person to merge two different
-- England Hockey ids (it still refuses without it, in case they really are
-- two people); merge_players_core() is the merge itself, for the SQL editor.
--
-- Safe to re-run.

create table if not exists public.player_eh_aliases (
  eh_member_id text primary key,
  player_id int not null references public.players (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.player_eh_aliases enable row level security;
revoke all on public.player_eh_aliases from anon, authenticated;

-- The player for an England Hockey member id: their own id or an alias.
create or replace function public.player_for_eh(p_member_id text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select id from public.players where eh_member_id = p_member_id),
    (select player_id from public.player_eh_aliases where eh_member_id = p_member_id)
  );
$$;
revoke execute on function public.player_for_eh(text) from public, anon, authenticated;

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

create or replace function public.merge_players_core(p_from int, p_into int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.players;
  v_into public.players;
  r record;
begin
  if p_from = p_into then
    raise exception 'Pick a different player to merge into.';
  end if;
  select * into v_from from public.players where id = p_from for update;
  select * into v_into from public.players where id = p_into for update;
  if v_from.id is null or v_into.id is null then
    raise exception 'Player not found.';
  end if;
  -- The same person under two England Hockey ids: the sync maps the one
  -- going away to the player kept, so it doesn't make them again.
  update public.player_eh_aliases set player_id = p_into where player_id = p_from;
  if v_from.eh_member_id is not null and v_into.eh_member_id is not null
     and v_from.eh_member_id <> v_into.eh_member_id then
    insert into public.player_eh_aliases (eh_member_id, player_id)
    values (v_from.eh_member_id, p_into)
    on conflict (eh_member_id) do update set player_id = excluded.player_id;
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

  -- A squad with both: drop the merged pick, but hand its armband and
  -- starting place to the one kept (after the delete, so no clash).
  for r in
    select f.user_id, f.gameweek_id, f.is_captain, f.is_vice, f.bench_order
    from public.picks f
    where f.player_id = p_from
      and exists (
        select 1 from public.picks t
        where t.player_id = p_into and t.user_id = f.user_id and t.gameweek_id = f.gameweek_id
      )
  loop
    delete from public.picks
    where player_id = p_from and user_id = r.user_id and gameweek_id = r.gameweek_id;
    update public.picks t
    set is_captain = t.is_captain or r.is_captain,
        is_vice = (t.is_vice or r.is_vice) and not (t.is_captain or r.is_captain),
        bench_order = case when r.bench_order is null then null else t.bench_order end
    where t.player_id = p_into and t.user_id = r.user_id and t.gameweek_id = r.gameweek_id;
  end loop;
  update public.picks set player_id = p_into where player_id = p_from;

  delete from public.players where id = p_from;
  update public.players
  set eh_member_id = coalesce(v_into.eh_member_id, v_from.eh_member_id)
  where id = p_into;
  -- Kept as the main id now, so not also an alias.
  delete from public.player_eh_aliases a
  using public.players p
  where p.id = p_into and a.eh_member_id = p.eh_member_id;
end;
$$;
revoke execute on function public.merge_players_core(int, int) from public, anon, authenticated;

drop function if exists public.merge_players(int, int);
create or replace function public.merge_players(p_from int, p_into int, p_same_person boolean default false)
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
  select * into v_from from public.players where id = p_from;
  select * into v_into from public.players where id = p_into;
  if v_from.eh_member_id is not null and v_into.eh_member_id is not null
     and v_from.eh_member_id <> v_into.eh_member_id and not p_same_person then
    raise exception '% and % are different people on England Hockey.', v_from.name, v_into.name;
  end if;
  perform public.merge_players_core(p_from, p_into);
end;
$$;
revoke execute on function public.merge_players(int, int, boolean) from public, anon;
grant execute on function public.merge_players(int, int, boolean) to authenticated;
