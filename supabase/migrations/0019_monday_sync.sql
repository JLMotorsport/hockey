-- 0019: a Monday 09:00 (UK) sync as well as Saturday 20:00 and Sunday 17:00.
--
-- Weekly price changes are applied by a sync from the Monday after a
-- gameweek. Without a Monday sync the next one would be after the following
-- deadline, so transfers would use last week's prices. It also catches
-- results posted on Sunday evening.
--
-- Safe to run again.

create or replace function public.weekend_sync_due(p_now timestamptz default now())
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (extract(isodow from l) = 6 and extract(hour from l) = 20
          or extract(isodow from l) = 7 and extract(hour from l) = 17
          or extract(isodow from l) = 1 and extract(hour from l) = 9)
     and extract(minute from l) < 10
  from (select p_now at time zone 'Europe/London' as l) t
$$;

-- Top of every hour Saturday to Monday (UTC); the function decides.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ff-sync-weekend') then
    perform cron.unschedule('ff-sync-weekend');
  end if;
  perform cron.schedule('ff-sync-weekend', '0 * * * 6,0,1', 'select public.run_weekend_sync()');
end;
$$;
