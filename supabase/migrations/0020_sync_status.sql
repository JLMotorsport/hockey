-- 0020: the latest England Hockey sync result for each side (and prices).
--
-- eh-sync writes one row per side every time it runs, scheduled or by hand,
-- so a side whose sync keeps failing shows on the managers' overview instead
-- of only in the reply to whoever pressed Sync now.
--
-- Safe to run again.

create table if not exists public.sync_status (
  -- The side's name, or 'Prices' for the weekly price changes.
  source text primary key,
  side_id int references public.sides (id) on delete cascade,
  ok boolean not null,
  message text not null default '',
  synced_at timestamptz not null default now(),
  -- When it last worked (kept while it fails), so managers can see how long.
  last_ok_at timestamptz
);

alter table public.sync_status enable row level security;
revoke all on public.sync_status from anon, authenticated;
grant select on public.sync_status to authenticated;

-- Managers read it; only eh-sync (service role) writes it.
drop policy if exists sync_status_admin_read on public.sync_status;
create policy sync_status_admin_read on public.sync_status
  for select to authenticated
  using (public.is_admin());

-- Record one run's results. last_ok_at moves on with each success.
create or replace function public.record_sync_results(p_results jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.sync_status as s (source, side_id, ok, message, synced_at, last_ok_at)
  select r.source, r.side_id, r.ok, coalesce(r.message, ''), now(),
         case when r.ok then now() end
  from jsonb_to_recordset(p_results)
    as r(source text, side_id int, ok boolean, message text)
  on conflict (source) do update
    set side_id = excluded.side_id,
        ok = excluded.ok,
        message = excluded.message,
        synced_at = excluded.synced_at,
        last_ok_at = coalesce(excluded.last_ok_at, s.last_ok_at);
$$;
revoke execute on function public.record_sync_results(jsonb) from public, anon, authenticated;
grant execute on function public.record_sync_results(jsonb) to service_role;
