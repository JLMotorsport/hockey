-- When each person last used the app, for the super user only: is the league still being used?
-- One row per person, written by the app (at most every 10 minutes), read only through
-- last_seen_all(). Nothing else about what they did is kept. Safe to run again.

create table if not exists public.user_last_seen (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now()
);
alter table public.user_last_seen enable row level security;
revoke all on public.user_last_seen from anon, authenticated;

-- The app calls this when it opens or comes back to the front. Quiet within 10 minutes.
create or replace function public.touch_last_seen()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.user_last_seen (user_id, seen_at)
  select auth.uid(), now()
  where auth.uid() is not null
    and exists (select 1 from public.profiles p where p.id = auth.uid())
  on conflict (user_id) do update set seen_at = excluded.seen_at
    where public.user_last_seen.seen_at < now() - interval '10 minutes';
$$;
revoke execute on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;

-- Everyone's last use, for the super user's Users page. Anyone else gets nothing.
create or replace function public.last_seen_all()
returns table (user_id uuid, seen_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id, s.seen_at from public.user_last_seen s where public.is_super();
$$;
revoke execute on function public.last_seen_all() from public, anon;
grant execute on function public.last_seen_all() to authenticated;
