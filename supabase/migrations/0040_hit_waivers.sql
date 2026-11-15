-- Waive someone's transfer cost for one gameweek (a genuine mistake), keeping
-- their squad as it is. Added by hand in the SQL editor; the app reads it
-- through transfer_hit(), so Points, the scoreboard and the league table all
-- show the cost as 0. Their transfers still count as used, so free transfers
-- banked for later weeks don't change. Safe to run again.

create table if not exists public.transfer_hit_waivers (
  user_id uuid not null references public.profiles (id) on delete cascade,
  gameweek_id int not null references public.gameweeks (id) on delete cascade,
  reason text,
  waived_at timestamptz not null default now(),
  primary key (user_id, gameweek_id)
);
alter table public.transfer_hit_waivers enable row level security;
revoke all on public.transfer_hit_waivers from anon, authenticated;

-- Adding or removing a waiver rebuilds the league table, as other score changes do.
drop trigger if exists league_cache_hit_waivers on public.transfer_hit_waivers;
create trigger league_cache_hit_waivers after insert or update or delete on public.transfer_hit_waivers
  for each statement execute function public.league_cache_bump();

-- As 0024, plus: nothing off for a waived gameweek.
create or replace function public.transfer_hit(p_user uuid, p_gameweek int)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.league_settings;
  v_used int;
begin
  if exists (
    select 1 from public.transfer_hit_waivers w
    where w.user_id = p_user and w.gameweek_id = p_gameweek
  ) then
    return 0;
  end if;
  select * into v_settings from public.league_settings where id = 1;
  if v_settings.scoring_from is not null
     and (select start_date from public.gameweeks where id = p_gameweek) <= v_settings.scoring_from then
    return 0;
  end if;
  v_used := public.transfers_used(p_user, p_gameweek);
  if v_used = 0 then
    return 0;
  end if;
  return greatest(0, v_used - public.free_transfers(p_user, p_gameweek)) * v_settings.transfer_hit;
end;
$$;
revoke execute on function public.transfer_hit(uuid, int) from public, anon, authenticated;

-- League totals are cached: rebuild them.
update public.league_cache_state set version = version + 1 where id = 1;
