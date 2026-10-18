-- Walkovers: a game one side conceded, so nobody played. England Hockey
-- marks them (with a notional 5-0); the sync now stores which way it went.
--
-- * fixtures.walkover: 'for' (awarded to us) or 'against' (we conceded).
-- * Nobody scores from a walkover: a walkover can't have player stats, and
--   any already entered go when a game is marked as one.
-- * The result still counts as a win or a loss (it does in the league).
--
-- Run the sync after this to mark past walkovers. Safe to re-run.

alter table public.fixtures add column if not exists walkover text;
alter table public.fixtures drop constraint if exists fixtures_walkover_check;
alter table public.fixtures add constraint fixtures_walkover_check
  check (walkover is null or walkover in ('for', 'against'));

-- As 0002, with the walkover.
create or replace function public.import_fixtures(p_side_id int, p_competition text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created int := 0;
  v_updated int := 0;
  v_inserted boolean;
  r jsonb;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'))
  loop
    insert into public.fixtures (
      side_id, eh_fixture_id, kickoff, opponent, is_home, competition, goals_for, goals_against, walkover
    )
    values (
      p_side_id,
      r ->> 'eh_fixture_id',
      (r ->> 'kickoff')::timestamp at time zone 'Europe/London',
      r ->> 'opponent',
      (r ->> 'is_home')::boolean,
      p_competition,
      (r ->> 'goals_for')::int,
      (r ->> 'goals_against')::int,
      nullif(r ->> 'walkover', '')
    )
    on conflict (side_id, eh_fixture_id) do update set
      kickoff = excluded.kickoff,
      opponent = excluded.opponent,
      is_home = excluded.is_home,
      competition = excluded.competition,
      walkover = excluded.walkover,
      goals_for = case
        when fixtures.score_overridden or excluded.goals_for is null or excluded.goals_against is null
        then fixtures.goals_for else excluded.goals_for end,
      goals_against = case
        when fixtures.score_overridden or excluded.goals_for is null or excluded.goals_against is null
        then fixtures.goals_against else excluded.goals_against end
    returning (xmax = 0) into v_inserted;

    if v_inserted then v_created := v_created + 1; else v_updated := v_updated + 1; end if;
  end loop;

  if p_competition is not null then
    update public.sides set competition = p_competition where id = p_side_id;
  end if;
  return jsonb_build_object('created', v_created, 'updated', v_updated);
end;
$$;

-- No stats on a walkover.
create or replace function public.performances_no_walkover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.fixtures where id = new.fixture_id and walkover is not null) then
    raise exception 'That game was a walkover: nobody played, so it has no player stats.';
  end if;
  return new;
end;
$$;
drop trigger if exists performances_no_walkover on public.performances;
create trigger performances_no_walkover
  before insert or update on public.performances
  for each row execute function public.performances_no_walkover();

-- Marking a game as a walkover clears any stats on it.
create or replace function public.fixtures_walkover_clears_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.walkover is not null and old.walkover is distinct from new.walkover then
    delete from public.performances where fixture_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists fixtures_walkover_clears_stats on public.fixtures;
create trigger fixtures_walkover_clears_stats
  after update of walkover on public.fixtures
  for each row execute function public.fixtures_walkover_clears_stats();

-- Points may change: the league table rebuilds next time it's read.
update public.league_cache_state set version = version + 1 where id = 1;
