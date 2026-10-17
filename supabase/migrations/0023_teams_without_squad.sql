-- 0023: which teams have never saved a squad, so the league table can say
-- "No team saved yet" and prompt the person themselves. Only yes or no per
-- team: what's in anyone's squad stays hidden until the deadline.
--
-- Safe to run again.

create or replace function public.teams_without_squad()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p
  where not exists (select 1 from public.picks k where k.user_id = p.id);
$$;
revoke execute on function public.teams_without_squad() from public;
grant execute on function public.teams_without_squad() to anon, authenticated;
