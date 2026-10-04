-- Player prices from points.
--
-- Starting prices: a manager presses "Set prices from points" once. Each
-- player's points per game (steadied towards their position's average when
-- they've only played a game or two) is ranked against others in the same
-- position, so keepers aren't penalised for conceding, and spread from 4.0m
-- to 10.0m in 0.5m steps.
--
-- Weekly changes: once a gameweek's weekend is over, each player who played
-- moves up or down a little depending on how their points compared with the
-- average for their position that week. Runs from the eh-sync function
-- (apply_due_price_changes), once per gameweek.
--
-- Safe to re-run.

-- Every price change, for the "price rose/fell" arrows and an audit trail.
create table if not exists public.price_changes (
  id serial primary key,
  player_id int not null references public.players (id) on delete cascade,
  gameweek_id int references public.gameweeks (id) on delete set null,
  old_price int not null,
  new_price int not null,
  reason text not null check (reason in ('initial', 'weekly')),
  created_at timestamptz not null default now()
);
create index if not exists price_changes_player_idx on public.price_changes (player_id, created_at desc);

-- Gameweeks whose weekly price changes have been applied (or that came
-- before the starting prices were set).
create table if not exists public.gameweek_pricing (
  gameweek_id int primary key references public.gameweeks (id) on delete cascade,
  applied_at timestamptz not null default now()
);

alter table public.price_changes enable row level security;
alter table public.gameweek_pricing enable row level security;
drop policy if exists price_changes_read on public.price_changes;
create policy price_changes_read on public.price_changes for select using (true);
drop policy if exists gameweek_pricing_read on public.gameweek_pricing;
create policy gameweek_pricing_read on public.gameweek_pricing for select using (true);
revoke insert, update, delete on public.price_changes, public.gameweek_pricing from anon, authenticated;

-- Price limits in tenths: starting prices span 4.0 to 10.0; weekly changes
-- keep everyone between 3.5 and 13.0.
create or replace function public.price_floor() returns int language sql immutable set search_path = '' as $$ select 35 $$;
create or replace function public.price_ceiling() returns int language sql immutable set search_path = '' as $$ select 130 $$;

-- Each player's most recent weekly change, for arrows in the app.
create or replace view public.player_price_trend
with (security_invoker = true) as
select distinct on (player_id) player_id, new_price - old_price as change, gameweek_id
from public.price_changes
where reason = 'weekly'
order by player_id, created_at desc, id desc;

create or replace function public.set_prices_from_points()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  perform public.require_admin();

  with stats as (
    select
      p.id,
      p.position,
      p.price as old_price,
      count(pf.id) as apps,
      coalesce(sum(public.performance_points(
        p.position, pf.goals, pf.assists, pf.green_cards, pf.yellow_cards, pf.red_cards,
        pf.player_of_match, f.goals_for, f.goals_against
      )), 0) as pts
    from public.players p
    left join public.performances pf on pf.player_id = p.id
    left join public.fixtures f on f.id = pf.fixture_id
    group by p.id
  ),
  position_avg as (
    select position, coalesce(sum(pts)::numeric / nullif(sum(apps), 0), 0) as avg_ppg
    from stats group by position
  ),
  steadied as (
    -- Two imaginary average games, so one big match doesn't make a star.
    select s.*, (s.pts + a.avg_ppg * 2) / (s.apps + 2) as rating
    from stats s join position_avg a using (position)
  ),
  ranked as (
    -- Position in the ranking from 0 (worst) to 1 (best). Tied players share
    -- the middle of the places they span, so a group of players with no games
    -- lands mid-table rather than at the bottom.
    select
      id,
      old_price,
      case when count(*) over p = 1 then 0.5
        else ((rank() over w - 1) + (cume_dist() over w * count(*) over p - 1))
             / (2.0 * (count(*) over p - 1))
      end as pr
    from steadied
    window
      p as (partition by position),
      w as (partition by position order by rating)
  ),
  priced as (
    select id, old_price, 40 + (round(pr * 12) * 5)::int as new_price from ranked
  ),
  changed as (
    update public.players p set price = priced.new_price
    from priced where p.id = priced.id
    returning p.id, priced.old_price, priced.new_price
  )
  insert into public.price_changes (player_id, old_price, new_price, reason)
  select id, old_price, new_price, 'initial' from changed;
  get diagnostics v_count = row_count;

  -- Weekly changes start from the next gameweek.
  insert into public.gameweek_pricing (gameweek_id)
  select id from public.gameweeks where deadline <= now()
  on conflict do nothing;
  return v_count;
end;
$$;

-- One gameweek's changes. Internal: called by apply_due_price_changes.
create or replace function public.apply_price_changes(p_gameweek int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if exists (select 1 from public.gameweek_pricing where gameweek_id = p_gameweek) then
    return 0;
  end if;

  with week as (
    select pgp.player_id, pgp.points, p.position, p.price
    from public.player_gameweek_points pgp
    join public.players p on p.id = pgp.player_id
    where pgp.gameweek_id = p_gameweek
  ),
  avg_week as (
    select position, avg(points) as avg_pts from week group by position
  ),
  moves as (
    select
      w.player_id,
      w.price as old_price,
      least(public.price_ceiling(), greatest(public.price_floor(), w.price +
        case
          when w.points - a.avg_pts >= 4 then 3
          when w.points - a.avg_pts >= 2 then 2
          when w.points - a.avg_pts >= 0.5 then 1
          when w.points - a.avg_pts <= -3 then -2
          when w.points - a.avg_pts <= -1 then -1
          else 0
        end)) as new_price
    from week w join avg_week a using (position)
  ),
  changed as (
    update public.players p set price = m.new_price
    from moves m
    where p.id = m.player_id and m.new_price <> m.old_price
    returning p.id, m.old_price, m.new_price
  )
  insert into public.price_changes (player_id, gameweek_id, old_price, new_price, reason)
  select id, p_gameweek, old_price, new_price, 'weekly' from changed;
  get diagnostics v_count = row_count;

  insert into public.gameweek_pricing (gameweek_id) values (p_gameweek) on conflict do nothing;
  return v_count;
end;
$$;
revoke execute on function public.apply_price_changes(int) from public, anon, authenticated;

-- Apply every gameweek whose weekend is over (from the Monday) and that has
-- stats, once starting prices exist. Called by the eh-sync function after it
-- imports line-ups; managers may also run it.
create or replace function public.apply_due_price_changes()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gw record;
  v_total int := 0;
  v_weeks int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    perform public.require_admin();
  end if;
  if not exists (select 1 from public.gameweek_pricing) then
    return jsonb_build_object('weeks', 0, 'changes', 0, 'waiting_for_starting_prices', true);
  end if;

  for v_gw in
    select g.id from public.gameweeks g
    where g.deadline <= now()
      and g.start_date + 2 <= (now() at time zone 'Europe/London')::date
      and not exists (select 1 from public.gameweek_pricing gp where gp.gameweek_id = g.id)
      and exists (
        select 1 from public.performances pf join public.fixtures f on f.id = pf.fixture_id
        where f.gameweek_id = g.id
      )
    order by g.start_date
  loop
    v_total := v_total + public.apply_price_changes(v_gw.id);
    v_weeks := v_weeks + 1;
  end loop;
  return jsonb_build_object('weeks', v_weeks, 'changes', v_total);
end;
$$;
revoke execute on function public.apply_due_price_changes() from public, anon;
grant execute on function public.apply_due_price_changes() to authenticated, service_role;
