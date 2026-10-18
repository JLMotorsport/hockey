-- Fixture difficulty from the gap between the two teams, not just the
-- opponent's place: each league table now marks which row is our side, and
-- fixture_difficulty() also gives our place (src/lib/fdr.ts does the rating).
--
-- Safe to re-run.

alter table public.league_tables add column if not exists is_us boolean not null default false;

create or replace function public.import_league_table(p_side_id int, p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
begin
  -- An empty table (between seasons, a feed hiccup) keeps the last good one.
  if v_count = 0 then
    return 0;
  end if;
  delete from public.league_tables where side_id = p_side_id;
  insert into public.league_tables (side_id, team_name, is_us, position, teams, played, points)
  select p_side_id, r.team_name, coalesce(r.is_us, false), r.position, v_count,
    coalesce(r.played, 0), coalesce(r.points, 0)
  from jsonb_to_recordset(p_rows) as r(team_name text, is_us boolean, position int, played int, points int)
  where r.team_name is not null
  on conflict (side_id, team_name) do nothing;
  return v_count;
end;
$$;
revoke execute on function public.import_league_table(int, jsonb) from public, anon, authenticated;
grant execute on function public.import_league_table(int, jsonb) to service_role;

-- Its columns change, so it's dropped and made again.
drop function if exists public.fixture_difficulty();
create or replace function public.fixture_difficulty()
returns table (fixture_id int, place int, our_place int, teams int)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, t.position,
    (select u.position from public.league_tables u where u.side_id = f.side_id and u.is_us limit 1),
    t.teams
  from public.fixtures f
  join public.league_tables t
    on t.side_id = f.side_id and lower(trim(t.team_name)) = lower(trim(f.opponent))
  where coalesce((select s.fdr_live from public.league_settings s where s.id = 1), false)
     or public.is_super();
$$;
revoke execute on function public.fixture_difficulty() from public;
grant execute on function public.fixture_difficulty() to anon, authenticated;
