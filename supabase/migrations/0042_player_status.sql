-- Injured and unavailable players. A manager flags a player Doubtful or Out,
-- with a short note players see and an optional back-by date; on that date
-- the flag stops showing (the app treats it as Available, so nothing has to
-- run to clear it). Information only: it doesn't touch scoring, prices or
-- subs. Its own table, so a flag doesn't rebuild the league table. Everyone
-- can read it; only managers can change it. Safe to re-run.

create table if not exists public.player_status (
  player_id int primary key references public.players (id) on delete cascade,
  status text not null check (status in ('doubtful', 'out')),
  note text check (char_length(note) <= 80),
  back_by date,
  set_at timestamptz not null default now(),
  set_by uuid references public.profiles (id) on delete set null default auth.uid()
);
alter table public.player_status enable row level security;
revoke all on public.player_status from anon, authenticated;
grant select on public.player_status to anon, authenticated;
grant insert, update, delete on public.player_status to authenticated;

drop policy if exists player_status_read on public.player_status;
create policy player_status_read on public.player_status for select using (true);
drop policy if exists player_status_admin_write on public.player_status;
create policy player_status_admin_write on public.player_status for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
