-- A manager marks one player trained (or not) on one day, by hand: for a
-- check-in the manager at training missed (0044). The league table rebuilds
-- (the training_attendance trigger). Managers only. Safe to re-run.
create or replace function public.set_training_day(p_player int, p_day date, p_trained boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only managers can change training.';
  end if;
  if p_trained then
    insert into public.training_attendance (player_id, trained_on)
    values (p_player, p_day)
    on conflict do nothing;
  else
    delete from public.training_attendance where player_id = p_player and trained_on = p_day;
  end if;
end;
$$;
revoke execute on function public.set_training_day(int, date, boolean) from public, anon;
grant execute on function public.set_training_day(int, date, boolean) to authenticated;
