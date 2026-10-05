-- Mini leagues: Men's, Women's and each side's own league.
--
-- Managers say which Felixstowe side they play for (optional: coaches,
-- parents and supporters leave it blank and are in the overall league only).
-- The league table page groups the overall table by it: Men's and Women's
-- from the side's name, and one league per side.
--
-- Safe to re-run.

alter table public.profiles add column if not exists side_id int references public.sides (id) on delete set null;

-- People set their own side, like their team name (still not is_admin).
grant update (side_id) on public.profiles to authenticated;

-- Sign-up can pass it too.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, team_name, is_admin, side_id)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)), 80),
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'team_name'), ''), 'My team'), 80),
    not exists (select 1 from public.profiles),
    -- Only a real side's id; anything else is ignored rather than failing sign-up.
    (select id from public.sides
     where (new.raw_user_meta_data ->> 'side_id') ~ '^[0-9]{1,9}$'
       and id = (new.raw_user_meta_data ->> 'side_id')::int)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
