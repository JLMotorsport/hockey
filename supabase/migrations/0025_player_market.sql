-- Selected by %, transfers in and transfers out, as FPL shows them.
--
-- Selected by: the share of managers with a squad who have the player in it
-- now (the squad going into the next gameweek, carried over or not).
-- Transfers in/out: this gameweek's changes so far against each manager's
-- squad from last gameweek. First squads aren't transfers.
--
-- Totals only: nobody's squad is shown before the deadline.
--
-- Safe to re-run.

create or replace function public.player_market()
returns table (player_id int, selected_by numeric, transfers_in int, transfers_out int)
language sql
stable
security definer
set search_path = ''
as $$
  with nxt as (
    select id, start_date from public.gameweeks where deadline > now() order by start_date limit 1
  ),
  prv as (
    select g.id from public.gameweeks g, nxt
    where g.start_date < nxt.start_date order by g.start_date desc limit 1
  ),
  mgr as (
    select pr.id as user_id,
      public.squad_source_gameweek(pr.id, (select id from nxt)) as cur_src,
      public.squad_source_gameweek(pr.id, (select id from prv)) as prev_src
    from public.profiles pr
  ),
  cur as (
    select m.user_id, p.player_id
    from mgr m join public.picks p on p.user_id = m.user_id and p.gameweek_id = m.cur_src
  ),
  prev as (
    select m.user_id, p.player_id
    from mgr m join public.picks p on p.user_id = m.user_id and p.gameweek_id = m.prev_src
    where m.cur_src is distinct from m.prev_src
  ),
  managers as (select count(distinct user_id) as n from cur),
  owned as (select c.player_id, count(*) as n from cur c group by c.player_id),
  ins as (
    select c.player_id, count(*) as n
    from cur c
    where exists (select 1 from prev v where v.user_id = c.user_id)
      and not exists (select 1 from prev v where v.user_id = c.user_id and v.player_id = c.player_id)
    group by c.player_id
  ),
  outs as (
    select v.player_id, count(*) as n
    from prev v
    where not exists (select 1 from cur c where c.user_id = v.user_id and c.player_id = v.player_id)
    group by v.player_id
  )
  select pl.id,
    case when managers.n > 0 then round(100.0 * coalesce(owned.n, 0) / managers.n, 1) else 0 end,
    coalesce(ins.n, 0)::int,
    coalesce(outs.n, 0)::int
  from public.players pl
  cross join managers
  left join owned on owned.player_id = pl.id
  left join ins on ins.player_id = pl.id
  left join outs on outs.player_id = pl.id;
$$;
revoke execute on function public.player_market() from public;
grant execute on function public.player_market() to anon, authenticated;
