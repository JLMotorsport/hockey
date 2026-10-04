-- Line-ups and players of the match from the club's Pitchero site.
--
-- Pitchero line-ups are public and give full names (no "Name Withheld"),
-- shirt numbers and the position each player lined up in. Some matches also
-- record a player of the match. The eh-sync function reads them and calls
-- import_pitchero(). The app uses them to suggest names for withheld players
-- and positions; managers confirm. Players of the match are imported directly
-- when the match doesn't already have one.
--
-- Safe to re-run.

alter table public.sides add column if not exists pitchero_team_id int;
update public.sides set pitchero_team_id = v.id
from (values
  ('felixstowe-1-mens', 262265),
  ('felixstowe-2-mens', 262268),
  ('felixstowe-3-mens', 262269),
  ('felixstowe-4-development-mens', 273482),
  ('felixstowe-1-womens', 262270),
  ('felixstowe-2-womens', 262271),
  ('felixstowe-3-development-womens', 263584)
) as v(slug, id)
where sides.eh_slug = v.slug and sides.pitchero_team_id is null;

alter table public.fixtures add column if not exists pitchero_imported_at timestamptz;

-- The Pitchero team sheet for a fixture, as published.
create table if not exists public.pitchero_lineups (
  fixture_id int not null references public.fixtures (id) on delete cascade,
  pitchero_player_id int not null,
  name text not null,
  shirt text,
  position text,
  starter boolean not null default true,
  primary key (fixture_id, pitchero_player_id)
);
alter table public.pitchero_lineups enable row level security;
drop policy if exists pitchero_lineups_read on public.pitchero_lineups;
create policy pitchero_lineups_read on public.pitchero_lineups for select using (true);
revoke insert, update, delete on public.pitchero_lineups from anon, authenticated;

-- "Thomas Rattle" and "Tom Rattle", "El-mahraoui" and "El-Mahraoui": first
-- initial plus surname, letters only. Only ever compared within one match.
create or replace function public.name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(w[1], 1) || ' ' || w[cardinality(w)]
  from (select regexp_split_to_array(trim(lower(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z ]', '', 'g'))), '\s+') as w) x
  where cardinality(w) >= 1 and w[1] <> '';
$$;

-- p_lineup: [{pitchero_player_id, name, shirt, position, starter}]
-- p_potm: [name, ...] from Pitchero's player-of-the-match field.
create or replace function public.import_pitchero(p_fixture_id int, p_lineup jsonb, p_potm jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fixture public.fixtures;
  v_potm int := 0;
  v_name text;
begin
  select * into v_fixture from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture % not found', p_fixture_id;
  end if;

  delete from public.pitchero_lineups where fixture_id = p_fixture_id;
  insert into public.pitchero_lineups (fixture_id, pitchero_player_id, name, shirt, position, starter)
  select
    p_fixture_id,
    (r ->> 'pitchero_player_id')::int,
    left(r ->> 'name', 120),
    nullif(r ->> 'shirt', ''),
    nullif(r ->> 'position', ''),
    coalesce((r ->> 'starter')::boolean, true)
  from jsonb_array_elements(coalesce(p_lineup, '[]')) r
  on conflict do nothing;

  -- Player of the match, if the match has none yet and isn't locked: match
  -- the name against players who have a stat line in this fixture.
  if not v_fixture.stats_locked
     and not exists (select 1 from public.performances where fixture_id = p_fixture_id and player_of_match) then
    for v_name in select jsonb_array_elements_text(coalesce(p_potm, '[]'))
    loop
      update public.performances pf set player_of_match = true
      from public.players p
      where pf.fixture_id = p_fixture_id
        and p.id = pf.player_id
        and not p.name_withheld
        and public.name_key(p.name) = public.name_key(v_name);
      if found then v_potm := v_potm + 1; end if;
    end loop;
  end if;

  update public.fixtures set pitchero_imported_at = now() where id = p_fixture_id;
  return jsonb_build_object('players', jsonb_array_length(coalesce(p_lineup, '[]')), 'potm', v_potm);
end;
$$;
revoke execute on function public.import_pitchero(int, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.import_pitchero(int, jsonb, jsonb) to service_role;
