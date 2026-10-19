-- A preview of Monday's price changes for managers (the Prices tab), live
-- over the weekend as results come in. The price rule moves into one
-- function, price_after(), used by both the preview and Monday's real change
-- (apply_price_changes, otherwise as 0008), so the two can't disagree.
--
-- Safe to re-run.

-- A player's price after a gameweek: points against its average.
create or replace function public.price_after(p_price int, p_points numeric, p_avg numeric)
returns int
language sql
immutable
set search_path = ''
as $$
  select least(public.price_ceiling(), greatest(public.price_floor(), p_price +
    case
      when p_points - p_avg >= 4 then 3
      when p_points - p_avg >= 2 then 2
      when p_points - p_avg >= 0.5 then 1
      when p_points - p_avg <= -3 then -2
      when p_points - p_avg <= -1 then -1
      else 0
    end));
$$;

create or replace function public.apply_price_changes(p_gameweek int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
  v_avg numeric;
begin
  if exists (select 1 from public.gameweek_pricing where gameweek_id = p_gameweek) then
    return 0;
  end if;

  select avg(points) into v_avg from public.player_gameweek_points where gameweek_id = p_gameweek;

  with moves as (
    select
      pgp.player_id,
      p.price as old_price,
      public.price_after(p.price, pgp.points, v_avg) as new_price
    from public.player_gameweek_points pgp
    join public.players p on p.id = pgp.player_id
    where pgp.gameweek_id = p_gameweek
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

-- The gameweek waiting for its price change (played, not yet priced), and
-- what each player who played in it would move to. Managers only.
create or replace function public.price_preview()
returns table (
  gameweek_id int, player_id int, name text, side_id int, player_position text,
  points int, average numeric, old_price int, new_price int, owned int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_gw int;
  v_avg numeric;
begin
  perform public.require_admin();
  select g.id into v_gw from public.gameweeks g
  where g.deadline <= now()
    and not exists (select 1 from public.gameweek_pricing gp where gp.gameweek_id = g.id)
    and exists (
      select 1 from public.performances pf join public.fixtures f on f.id = pf.fixture_id
      where f.gameweek_id = g.id
    )
  order by g.start_date
  limit 1;
  if v_gw is null then
    return;
  end if;
  select avg(pgp.points) into v_avg from public.player_gameweek_points pgp where pgp.gameweek_id = v_gw;
  return query
  select v_gw, p.id, p.name, p.side_id, p.position, pgp.points, round(v_avg, 1), p.price,
    public.price_after(p.price, pgp.points, v_avg),
    (
      select count(*)::int from public.profiles pr
      join public.picks k on k.user_id = pr.id
        and k.gameweek_id = public.squad_source_gameweek(pr.id, v_gw)
      where k.player_id = p.id
    )
  from public.player_gameweek_points pgp
  join public.players p on p.id = pgp.player_id
  where pgp.gameweek_id = v_gw;
end;
$$;
revoke execute on function public.price_preview() from public, anon;
grant execute on function public.price_preview() to authenticated;
