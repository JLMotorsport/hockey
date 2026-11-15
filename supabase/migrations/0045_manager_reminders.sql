-- Remind the managers on Sunday if the week's uploads haven't been done (0045).
-- Every training and availability upload is logged; the hourly reminders job
-- (0027) sends a push to the super user (if their phone has notifications on) at 4pm on Sunday,
-- and again at 8pm, if either hasn't been uploaded since Saturday's deadline.
-- Once each per Sunday (manager_reminder_log). Also: training points count
-- from GW11 (Sat 21 Nov 2026), not GW14. Safe to re-run.

update public.league_settings set training_from = '2026-11-21' where id = 1;

create table if not exists public.upload_log (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('training', 'availability')),
  at timestamptz not null default now(),
  by_user uuid references public.profiles (id) on delete set null default auth.uid()
);
alter table public.upload_log enable row level security;
revoke all on public.upload_log from anon, authenticated;

create table if not exists public.manager_reminder_log (
  day date not null,
  slot text not null,
  sent_at timestamptz not null default now(),
  primary key (day, slot)
);
alter table public.manager_reminder_log enable row level security;
revoke all on public.manager_reminder_log from anon, authenticated;

-- As 0043 and 0044, now logging each upload.
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
  insert into public.upload_log (kind) values ('availability');
  return v_count;
end;
$$;
revoke execute on function public.apply_pitchero_availability(jsonb) from public, anon;
grant execute on function public.apply_pitchero_availability(jsonb) to authenticated;

create or replace function public.apply_training(p_days date[], p_rows jsonb, p_aliases jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Only managers can upload training.';
  end if;
  insert into public.player_aliases (alias, player_id)
  select a.alias, a.player_id
  from jsonb_to_recordset(coalesce(p_aliases, '[]')) as a(alias text, player_id int)
  where a.alias <> '' and exists (select 1 from public.players p where p.id = a.player_id)
  on conflict (alias) do update set player_id = excluded.player_id;
  delete from public.training_attendance where trained_on = any (coalesce(p_days, '{}'));
  insert into public.training_attendance (player_id, trained_on)
  select distinct r.player_id, r.trained_on
  from jsonb_to_recordset(coalesce(p_rows, '[]')) as r(player_id int, trained_on date)
  where r.trained_on = any (coalesce(p_days, '{}'))
    and exists (select 1 from public.players p where p.id = r.player_id)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  insert into public.upload_log (kind) values ('training');
  return v_count;
end;
$$;
revoke execute on function public.apply_training(date[], jsonb, jsonb) from public, anon;
grant execute on function public.apply_training(date[], jsonb, jsonb) to authenticated;

-- For the reminders job: what's still to upload since the last deadline, and
-- the super user's phones to tell.
create or replace function public.manager_uploads_missing()
returns table (training boolean, availability boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with since as (
    select coalesce(max(g.deadline), '-infinity'::timestamptz) as at
    from public.gameweeks g where g.deadline <= now()
  )
  select
    not exists (select 1 from public.upload_log u, since where u.kind = 'training' and u.at >= since.at),
    not exists (select 1 from public.upload_log u, since where u.kind = 'availability' and u.at >= since.at);
$$;
revoke execute on function public.manager_uploads_missing() from public, anon, authenticated;

create or replace function public.manager_phones()
returns table (endpoint text, p256dh text, auth text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  join public.profiles p on p.id = s.user_id
  where p.is_super;
$$;
revoke execute on function public.manager_phones() from public, anon, authenticated;
