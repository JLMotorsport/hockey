-- Merging two players (0026) now carries over what came later: training
-- check-ins (0044), a flag (0042), linked Pitchero names, and remembers the
-- merged player's name so a check-in under it still finds the kept player.
-- Before this, merging deleted those along with the duplicate. Safe to re-run.

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

  -- Training (0044): the days either trained. Flags (0042): the kept
  -- player's own flag wins. Names linked to the merged one now find the kept
  -- one, and so does the merged one's own name (a Pitchero check-in under it).
  insert into public.training_attendance (player_id, trained_on)
  select p_into, a.trained_on from public.training_attendance a where a.player_id = p_from
  on conflict do nothing;
  insert into public.player_status (player_id, status, note, back_by, set_at, set_by, source)
  select p_into, s.status, s.note, s.back_by, s.set_at, s.set_by, s.source
  from public.player_status s where s.player_id = p_from
  on conflict (player_id) do nothing;
  update public.player_aliases set player_id = p_into where player_id = p_from;
  insert into public.player_aliases (alias, player_id)
  values (regexp_replace(lower(v_from.name), '[^a-z]', '', 'g'), p_into)
  on conflict (alias) do update set player_id = excluded.player_id;

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
