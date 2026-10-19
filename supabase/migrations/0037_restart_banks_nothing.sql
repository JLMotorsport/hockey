-- Free transfers: the week scoring restarted is everyone's first week. Before,
-- a manager with a squad from before the restart banked their restart week's
-- transfers (4 the week after) while everyone who joined at the restart had 2.
-- Banking now starts from the restart for all.
--
-- Safe to re-run.

create or replace function public.free_transfers(p_user uuid, p_gameweek int)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.league_settings;
  v_free int;
  v_prev int;
  g record;
begin
  select * into v_settings from public.league_settings where id = 1;
  v_free := v_settings.transfers_per_gameweek;
  for g in
    select id from public.gameweeks
    where start_date >= coalesce(v_settings.scoring_from, '-infinity'::date)
      and start_date < (select start_date from public.gameweeks where id = p_gameweek)
    order by start_date
  loop
    if public.squad_source_gameweek(p_user, g.id) is null then
      v_free := v_settings.transfers_per_gameweek; -- not playing yet
    else
      v_prev := (
        select x.id from public.gameweeks x
        where x.start_date < (select start_date from public.gameweeks where id = g.id)
        order by x.start_date desc limit 1
      );
      -- First squad, or the week scoring restarted (a fresh start for everyone,
      -- so a squad from before it banks nothing): nothing banked.
      if v_prev is null or public.squad_source_gameweek(p_user, v_prev) is null
         or (select x.start_date from public.gameweeks x where x.id = v_prev)
            < coalesce(v_settings.scoring_from, '-infinity'::date) then
        v_free := v_settings.transfers_per_gameweek;
      else
        v_free := least(
          greatest(v_settings.max_free_transfers, v_settings.transfers_per_gameweek),
          greatest(0, v_free - public.transfers_used(p_user, g.id)) + v_settings.transfers_per_gameweek
        );
      end if;
    end if;
  end loop;
  return v_free;
end;
$$;

-- Transfer hits feed the league table: rebuild it next time it's read.
update public.league_cache_state set version = version + 1 where id = 1;
