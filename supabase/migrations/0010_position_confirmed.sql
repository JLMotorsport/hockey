-- Positions a manager has settled, so Pitchero stops suggesting them.
--
-- The Positions from Pitchero card suggested a change every time the admin
-- page loaded, even after a manager decided Pitchero was wrong. Now a player
-- whose position a manager has set or confirmed is left alone: rejecting a
-- suggestion marks it, and so does changing the position by hand.
--
-- Safe to re-run.

alter table public.players add column if not exists position_confirmed boolean not null default false;

create or replace function public.players_confirm_position()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.position is distinct from old.position then
    new.position_confirmed := true;
  end if;
  return new;
end;
$$;

drop trigger if exists players_confirm_position on public.players;
create trigger players_confirm_position
  before update of position on public.players
  for each row execute function public.players_confirm_position();
