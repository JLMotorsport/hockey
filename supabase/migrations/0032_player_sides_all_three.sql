-- A player now moves side only when all of their last 3 games were for that
-- side (0031 moved them on 2 of 3, which was too quick: Alex Williams went to
-- M2 after two games there).
--
-- Once, here: players the 2-of-3 rule may have moved (last 3 games not all
-- one side, now on the side most of those were for) go back to the side
-- they've played for most this season, unless a manager locked them.
--
-- Safe to re-run: the undo below runs once.

create or replace function public.refresh_player_sides()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved int;
begin
  with recent as (
    select pf.player_id, f.side_id,
      row_number() over (partition by pf.player_id order by f.kickoff desc, f.id desc) as n
    from public.performances pf
    join public.fixtures f on f.id = pf.fixture_id
    where f.goals_for is not null and f.goals_against is not null
  ),
  settled as (
    -- Three games, all for one side.
    select player_id, min(side_id) as side_id
    from recent where n <= 3
    group by player_id
    having count(*) = 3 and count(distinct side_id) = 1
  ),
  moved as (
    update public.players p set side_id = s.side_id
    from settled s
    where p.id = s.player_id and not p.side_locked and p.side_id <> s.side_id
    returning p.id
  )
  select count(*) into v_moved from moved;
  return v_moved;
end;
$$;
revoke execute on function public.refresh_player_sides() from public, anon, authenticated;
grant execute on function public.refresh_player_sides() to service_role;

-- One-off steps record that they ran, so pasting this again is safe.
create table if not exists public.one_off_runs (
  name text primary key,
  ran_at timestamptz not null default now()
);
alter table public.one_off_runs enable row level security;
revoke all on public.one_off_runs from anon, authenticated;

-- Undo the 2-of-3 moves, once only.
do $do$
begin
  if exists (select 1 from public.one_off_runs where name = '0032_undo_two_of_three') then
    return;
  end if;
  with games as (
    select pf.player_id, f.side_id, f.kickoff,
      row_number() over (partition by pf.player_id order by f.kickoff desc, f.id desc) as n
    from public.performances pf
    join public.fixtures f on f.id = pf.fixture_id
    where f.goals_for is not null and f.goals_against is not null
  ),
  last3 as (
    select player_id from games where n <= 3
    group by player_id
    having count(distinct side_id) > 1
  ),
  last3_most as (
    select distinct on (g.player_id) g.player_id, g.side_id
    from games g join last3 using (player_id)
    where g.n <= 3
    group by g.player_id, g.side_id
    order by g.player_id, count(*) desc, max(g.kickoff) desc
  ),
  season_most as (
    select distinct on (g.player_id) g.player_id, g.side_id
    from games g join last3 using (player_id)
    group by g.player_id, g.side_id
    order by g.player_id, count(*) desc, max(g.kickoff) desc
  )
  update public.players p set side_id = sm.side_id
  from last3_most lm
  join season_most sm using (player_id)
  where p.id = lm.player_id
    and not p.side_locked
    and p.side_id = lm.side_id
    and p.side_id <> sm.side_id;
  insert into public.one_off_runs (name) values ('0032_undo_two_of_three');
end;
$do$;
