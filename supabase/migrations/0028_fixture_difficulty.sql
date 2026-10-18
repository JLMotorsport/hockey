-- Fixture difficulty, as FPL's: each side's league table from England Hockey
-- (read by eh-sync), so an opponent can be rated by where they sit in it.
-- The rating itself is worked out in src/lib/fdr.ts.
--
-- * league_tables: each side's division, one row per team, kept by the sync.
-- * league_settings.fdr_live: off until the super user switches it on;
--   until then fixture_difficulty() only answers the super user.
--
-- Safe to re-run.

create table if not exists public.league_tables (
  side_id int not null references public.sides (id) on delete cascade,
  team_name text not null,
  position int not null,
  teams int not null,
  played int not null default 0,
  points int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (side_id, team_name)
);
alter table public.league_tables enable row level security;
revoke all on public.league_tables from anon, authenticated;

alter table public.league_settings add column if not exists fdr_live boolean not null default false;

-- The sync's copy of one side's table, in England Hockey's order (top first).
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
  insert into public.league_tables (side_id, team_name, position, teams, played, points)
  select p_side_id, r.team_name, r.position, v_count, coalesce(r.played, 0), coalesce(r.points, 0)
  from jsonb_to_recordset(p_rows) as r(team_name text, position int, played int, points int)
  where r.team_name is not null
  on conflict (side_id, team_name) do nothing;
  return v_count;
end;
$$;
revoke execute on function public.import_league_table(int, jsonb) from public, anon, authenticated;
grant execute on function public.import_league_table(int, jsonb) to service_role;

-- Where each fixture's opponent sits in that side's table. Nothing for anyone
-- but the super user until fdr_live is switched on.
create or replace function public.fixture_difficulty()
returns table (fixture_id int, place int, teams int)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, t.position, t.teams
  from public.fixtures f
  join public.league_tables t
    on t.side_id = f.side_id and lower(trim(t.team_name)) = lower(trim(f.opponent))
  where coalesce((select s.fdr_live from public.league_settings s where s.id = 1), false)
     or public.is_super();
$$;
revoke execute on function public.fixture_difficulty() from public;
grant execute on function public.fixture_difficulty() to anon, authenticated;
