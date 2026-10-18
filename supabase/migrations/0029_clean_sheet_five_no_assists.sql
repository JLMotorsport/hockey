-- Scoring change, for the whole season:
-- * a clean sheet is worth 5 to a keeper or defender (was 4);
-- * assists score nothing: they aren't tracked (England Hockey doesn't
--   publish them), so they're gone from the app too.
-- Everything else is as 0015. src/lib/scoring.ts mirrors this; the tests
-- check the two agree.
--
-- Safe to re-run.

create or replace function public.performance_points(
  p_position text,
  p_goals int,
  p_assists int,
  p_green int,
  p_yellow int,
  p_red int,
  p_player_of_match boolean,
  p_goals_for int,
  p_goals_against int,
  p_is_home boolean
)
returns int
language sql
immutable
set search_path = ''
as $$
  select
    1
    + p_goals * case p_position when 'GK' then 6 when 'DEF' then 6 when 'MID' then 5 else 4 end
    + case when p_goals_for is null or p_goals_against is null then 0 else
        -- Clean sheet
        case when p_goals_against = 0 then
          case p_position when 'GK' then 5 when 'DEF' then 5 when 'MID' then 1 else 0 end
        else 0 end
        -- GK and DEF lose a point for every 2 conceded
        - case when p_position in ('GK', 'DEF') then p_goals_against / 2 else 0 end
        -- Team win: 1 at home, 2 away
        + case when p_goals_for > p_goals_against then
            case when coalesce(p_is_home, true) then 1 else 2 end
          else 0 end
      end
    + case when p_player_of_match then 3 else 0 end
    - p_green
    - p_yellow * 2
    - p_red * 4;
$$;

-- The league table rebuilds with the new figures next time it's read.
update public.league_cache_state set version = version + 1 where id = 1;
