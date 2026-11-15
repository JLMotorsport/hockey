-- Flags from Pitchero availability (0042 flags, set from the weekly export).
-- A manager uploads next Saturday's availability; the app works out who is
-- Out or Doubtful and sends them here. Each upload replaces the last one's
-- flags; flags a manager set by hand are never touched (a manager editing a
-- Pitchero flag makes it theirs). Players only see Out or Doubtful with
-- "Pitchero" and the date, never which match or the notes people wrote.
-- Safe to re-run.

alter table public.player_status add column if not exists source text not null default 'manager';
alter table public.player_status drop constraint if exists player_status_source_check;
alter table public.player_status add constraint player_status_source_check
  check (source in ('manager', 'pitchero'));

create or replace function public.apply_pitchero_availability(p_flags jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Only managers can upload availability.';
  end if;
  delete from public.player_status where source = 'pitchero';
  insert into public.player_status (player_id, status, note, back_by, set_at, set_by, source)
  select f.player_id, f.status, left(f.note, 80), f.back_by, now(), auth.uid(), 'pitchero'
  from jsonb_to_recordset(coalesce(p_flags, '[]')) as f(player_id int, status text, note text, back_by date)
  where f.status in ('doubtful', 'out')
    and exists (select 1 from public.players p where p.id = f.player_id)
  on conflict (player_id) do nothing; -- a manager's own flag stays
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.apply_pitchero_availability(jsonb) from public, anon;
grant execute on function public.apply_pitchero_availability(jsonb) to authenticated;
