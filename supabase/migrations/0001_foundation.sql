-- Felixstowe HC fantasy hockey: tables, reference data and row-level security.
--
-- Applied by hand in the Supabase SQL editor, so everything here is safe to
-- re-run: `if not exists`, `create or replace`, `drop policy if exists`.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per account. Created by a trigger on sign-up (see below).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  team_name text not null check (char_length(team_name) between 1 and 80),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- A real Felixstowe HC side: Men's 1s, Women's 2s and so on.
create table if not exists public.sides (
  id serial primary key,
  name text not null unique,
  short_name text not null check (char_length(short_name) between 1 and 20),
  -- Last part of the team page address on englandhockey.co.uk, e.g.
  -- "felixstowe-1-mens". Null for sides that aren't on England Hockey.
  eh_slug text unique,
  competition text,
  sort_order int not null default 0
);

create table if not exists public.players (
  id serial primary key,
  name text not null check (char_length(name) between 1 and 120),
  position text not null check (position in ('GK', 'DEF', 'MID', 'FWD')),
  side_id int not null references public.sides (id),
  -- Tenths of a million so the maths stays in integers: 85 = 8.5m.
  price int not null default 50 check (price between 1 and 500),
  active boolean not null default true
);

-- One playing weekend. start_date is the Saturday of a Monday-to-Sunday week.
create table if not exists public.gameweeks (
  id serial primary key,
  start_date date not null unique,
  deadline timestamptz not null
);

create table if not exists public.fixtures (
  id serial primary key,
  side_id int not null references public.sides (id),
  -- Set by trigger from the kickoff date; never written directly.
  gameweek_id int not null references public.gameweeks (id),
  -- England Hockey's fixture id. Not unique on its own: when two Felixstowe
  -- sides meet, each side gets its own row for the same match.
  eh_fixture_id text,
  kickoff timestamptz not null,
  opponent text not null,
  is_home boolean not null default true,
  competition text,
  goals_for int check (goals_for >= 0),
  goals_against int check (goals_against >= 0),
  -- Set when a manager edits the score so the next sync won't overwrite it.
  score_overridden boolean not null default false,
  stats_complete boolean not null default false,
  unique (side_id, eh_fixture_id)
);

-- One player's stat line for one fixture. England Hockey doesn't publish
-- these, so managers enter them.
create table if not exists public.performances (
  id serial primary key,
  player_id int not null references public.players (id) on delete cascade,
  fixture_id int not null references public.fixtures (id) on delete cascade,
  goals int not null default 0 check (goals between 0 and 20),
  assists int not null default 0 check (assists between 0 and 20),
  green_cards int not null default 0 check (green_cards between 0 and 5),
  yellow_cards int not null default 0 check (yellow_cards between 0 and 5),
  red_cards int not null default 0 check (red_cards between 0 and 1),
  player_of_match boolean not null default false,
  unique (player_id, fixture_id)
);

-- A player in someone's fantasy squad from `gameweek_id` onwards. Rows exist
-- only for gameweeks where the squad was changed; the squad for any gameweek
-- is the latest saved set at or before it. Written only by save_squad().
create table if not exists public.picks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  gameweek_id int not null references public.gameweeks (id) on delete cascade,
  player_id int not null references public.players (id),
  is_captain boolean not null default false,
  primary key (user_id, gameweek_id, player_id)
);

create table if not exists public.league_settings (
  id int primary key default 1 check (id = 1),
  budget int not null default 1000 check (budget > 0), -- tenths: 1000 = 100.0m
  squad_size int not null default 11 check (squad_size = 11),
  max_per_side int not null default 4 check (max_per_side >= 1),
  transfers_per_gameweek int not null default 2 check (transfers_per_gameweek >= 0)
);

create index if not exists fixtures_gameweek_idx on public.fixtures (gameweek_id);
create index if not exists performances_fixture_idx on public.performances (fixture_id);
create index if not exists picks_gameweek_idx on public.picks (gameweek_id);

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

insert into public.league_settings (id) values (1) on conflict (id) do nothing;

insert into public.sides (name, short_name, eh_slug, sort_order) values
  ('Men''s 1s', 'M1', 'felixstowe-1-mens', 0),
  ('Men''s 2s', 'M2', 'felixstowe-2-mens', 1),
  ('Men''s 3s', 'M3', 'felixstowe-3-mens', 2),
  ('Men''s 4s', 'M4', 'felixstowe-4-development-mens', 3),
  ('Women''s 1s', 'W1', 'felixstowe-1-womens', 4),
  ('Women''s 2s', 'W2', 'felixstowe-2-womens', 5),
  ('Women''s 3s', 'W3', 'felixstowe-3-development-womens', 6)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- New sign-ups get a profile from the details on the sign-up form. The very
-- first account becomes the league manager.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, team_name, is_admin)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)), 80),
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'team_name'), ''), 'My team'), 80),
    not exists (select 1 from public.profiles)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.sides enable row level security;
alter table public.players enable row level security;
alter table public.gameweeks enable row level security;
alter table public.fixtures enable row level security;
alter table public.performances enable row level security;
alter table public.picks enable row level security;
alter table public.league_settings enable row level security;

-- Names, team names, players, fixtures and stats are public: the league table
-- and fixture list work without logging in.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);

-- People can rename themselves and their team, nothing else. Manager access
-- is changed through set_admin().
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (display_name, team_name) on public.profiles to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['sides', 'players', 'gameweeks', 'fixtures', 'performances', 'league_settings']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (true)', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_write', t
    );
  end loop;
end;
$$;

-- Your own picks are always visible. Everyone else's are revealed once that
-- gameweek's deadline passes, so nobody can copy a squad before lock.
drop policy if exists picks_read on public.picks;
create policy picks_read on public.picks for select using (
  user_id = auth.uid()
  or public.is_admin()
  or exists (select 1 from public.gameweeks g where g.id = gameweek_id and g.deadline <= now())
);
revoke insert, update, delete on public.picks from anon, authenticated;
