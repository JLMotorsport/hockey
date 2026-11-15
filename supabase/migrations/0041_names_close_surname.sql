-- A tighter close-name rule (from the code review). 0036 allowed one letter
-- out anywhere in a name of 8+ letters, so Tom / Tim Smith or Dan / Dani Smith
-- (often brothers and sisters) could be linked as one player, giving one of
-- them the other's England Hockey id and points. Now the surname (the last
-- word) must match exactly, and only the first names may be one letter apart,
-- both at least 5 letters (Denis / Dennis Keegan still links). Spaces, hyphens
-- and capitals are ignored. src/lib/pitcheroMatch.ts namesClose() is the same rule.
--
-- Safe to re-run.

create or replace function public.names_close(p_a text, p_b text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  a_all text := regexp_replace(lower(coalesce(p_a, '')), '[^a-z]', '', 'g');
  b_all text := regexp_replace(lower(coalesce(p_b, '')), '[^a-z]', '', 'g');
  a_words text[] := regexp_split_to_array(btrim(coalesce(p_a, '')), '\s+');
  b_words text[] := regexp_split_to_array(btrim(coalesce(p_b, '')), '\s+');
  a_last text;
  b_last text;
  a text;
  b text;
  i int := 1;
begin
  if a_all = '' or b_all = '' then
    return false;
  end if;
  if a_all = b_all then
    return true;
  end if;
  a_last := regexp_replace(lower(a_words[cardinality(a_words)]), '[^a-z]', '', 'g');
  b_last := regexp_replace(lower(b_words[cardinality(b_words)]), '[^a-z]', '', 'g');
  if a_last = '' or a_last <> b_last then
    return false;
  end if;
  a := regexp_replace(lower(array_to_string(a_words[1:cardinality(a_words) - 1], ' ')), '[^a-z]', '', 'g');
  b := regexp_replace(lower(array_to_string(b_words[1:cardinality(b_words) - 1], ' ')), '[^a-z]', '', 'g');
  if least(length(a), length(b)) < 5 or abs(length(a) - length(b)) > 1 then
    return false;
  end if;
  while i <= least(length(a), length(b)) and substr(a, i, 1) = substr(b, i, 1) loop
    i := i + 1;
  end loop;
  if length(a) = length(b) then
    return substr(a, i + 1) = substr(b, i + 1);
  elsif length(a) > length(b) then
    return substr(a, i + 1) = substr(b, i);
  else
    return substr(a, i) = substr(b, i + 1);
  end if;
end;
$$;
