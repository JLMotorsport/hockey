-- 0022: deleting an account. A player deletes their own; a manager removes
-- someone who asked the club. Either way the login, profile, team, every
-- squad, bank and chip go (profiles and everything under it cascade), and
-- the team leaves every league table.
--
-- Safe to run again: create or replace throughout.

-- Removing an account is in the change log (0021), but can't be undone: the
-- login itself is gone.
create or replace function public.log_account_removal(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.manager_log (actor, table_name, op, row_id, old_data)
  select auth.uid(), 'accounts', 'delete', p.id::text,
    jsonb_build_object('display_name', p.display_name, 'team_name', p.team_name, 'email', u.email)
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = p_user;
end;
$$;
revoke execute on function public.log_account_removal(uuid) from public, anon, authenticated;

-- Your own account. Typing your team name is the confirmation.
create or replace function public.delete_my_account(p_team_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Log in first.';
  end if;
  if v_me.is_super then
    raise exception 'The super user can''t delete their own account.';
  end if;
  if lower(trim(coalesce(p_team_name, ''))) <> lower(trim(v_me.team_name)) then
    raise exception 'That isn''t your team name.';
  end if;
  delete from auth.users where id = v_me.id;
end;
$$;
revoke execute on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

-- Someone else's, by a manager. Only the super user removes a manager, and
-- nobody removes the super user or themselves here.
create or replace function public.remove_user(p_user uuid, p_team_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_them public.profiles;
begin
  perform public.require_admin();
  if p_user = auth.uid() then
    raise exception 'To delete your own account, use Delete account.';
  end if;
  select * into v_them from public.profiles where id = p_user;
  if not found then
    raise exception 'That account has already gone.';
  end if;
  if v_them.is_super then
    raise exception 'The super user can''t be removed.';
  end if;
  if v_them.is_admin and not public.is_super() then
    raise exception 'Only the super user can remove a manager.';
  end if;
  if lower(trim(coalesce(p_team_name, ''))) <> lower(trim(v_them.team_name)) then
    raise exception 'That isn''t their team name.';
  end if;
  perform public.log_account_removal(p_user);
  delete from auth.users where id = p_user;
end;
$$;
revoke execute on function public.remove_user(uuid, text) from public, anon;
grant execute on function public.remove_user(uuid, text) to authenticated;

-- Undo (0021) leaves account removals alone, with a clear reason.
drop trigger if exists manager_log_accounts_final on public.manager_log;
drop function if exists public.undo_refuses_accounts();
create or replace function public.undo_change(p_id bigint)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx bigint;
  v_cur jsonb;
  v_cols text[];
  v_list text;
  c text;
  n int := 0;
  r public.manager_log;
begin
  if not public.is_super() then
    raise exception 'Only the super user can undo changes.';
  end if;
  select tx into v_tx from public.manager_log where id = p_id;
  if not found then
    raise exception 'That change isn''t in the log.';
  end if;
  if exists (select 1 from public.manager_log where tx = v_tx and undone_at is not null) then
    raise exception 'That change has already been undone.';
  end if;
  if exists (select 1 from public.manager_log where tx = v_tx and table_name = 'accounts') then
    raise exception 'Removing an account can''t be undone.';
  end if;
  perform set_config('fhc.undoing', 'on', true);

  -- Newest first; rows the action deleted go back last, parents before children.
  for r in
    select * from public.manager_log where tx = v_tx
    order by (op = 'delete'),
      case when op = 'delete' then array_position(
        array['sides', 'gameweeks', 'players', 'league_settings', 'profiles', 'fixtures', 'performances'], table_name)
      end,
      id desc
  loop
    execute format('select to_jsonb(t) from public.%I t where t.id::text = $1', r.table_name)
      into v_cur using r.row_id;
    if r.op = 'insert' then
      continue when v_cur is null; -- already gone (deleted along with its parent)
      if v_cur <> r.new_data then
        raise exception 'A %s added by this change has been edited since. Undo the later change first.', r.table_name;
      end if;
      execute format('delete from public.%I where id::text = $1', r.table_name) using r.row_id;
    elsif r.op = 'delete' then
      if v_cur is not null then
        raise exception 'A %s removed by this change is back again. Undo the later change first.', r.table_name;
      end if;
      execute format(
        'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', r.table_name, r.table_name
      ) using r.old_data;
    else
      if v_cur is null then
        raise exception 'A %s changed by this has been deleted since. Undo the later change first.', r.table_name;
      end if;
      v_cols := array(
        select key from jsonb_each(r.new_data) where r.old_data -> key is distinct from value
      );
      foreach c in array v_cols loop
        if v_cur -> c is distinct from r.new_data -> c then
          raise exception 'A %s changed by this has been edited again since. Undo the later change first.', r.table_name;
        end if;
      end loop;
      if cardinality(v_cols) > 0 then
        select string_agg(format('%I', x), ', ') into v_list from unnest(v_cols) x;
        execute format(
          'update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where t.id::text = $2',
          r.table_name, v_list, v_list, r.table_name
        ) using r.old_data, r.row_id;
      end if;
    end if;
    n := n + 1;
  end loop;

  update public.manager_log set undone_at = now(), undone_by = auth.uid() where tx = v_tx;
  return n;
end;
$$;
