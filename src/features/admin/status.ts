import {
  needsChecking,
  needsPosition,
  sidesWithoutKeeper,
  type MatchEvidence,
} from '@/lib/managers';
import {
  suggestPositions,
  suggestWithheldNames,
  type NameSuggestion,
  type PositionSuggestion,
} from '@/lib/pitcheroMatch';
import {
  useFixtures,
  usePitcheroEvidence,
  usePlayers,
  usePotmFixtures,
  useSides,
} from '@/lib/queries';

/**
 * Everything the managers' screens count: withheld names, positions to set,
 * matches to check, Pitchero suggestions. Shared so the menu badges and the
 * pages always agree.
 */
export function useManagerStatus() {
  const players = usePlayers();
  const fixtures = useFixtures();
  const sides = useSides();
  const evidence = usePitcheroEvidence();
  const potm = usePotmFixtures();

  const all = players.data ?? [];
  const byId = new Map(all.map((p) => [p.id, p]));
  const sheets = evidence.data?.sheets ?? [];
  const appearances = evidence.data?.appearances ?? [];

  const withPitchero = new Set(sheets.map((s) => s.fixture_id));
  const unnamed = new Map<number, number>();
  for (const a of appearances)
    if (a.name_withheld) unnamed.set(a.fixture_id, (unnamed.get(a.fixture_id) ?? 0) + 1);

  const positionSuggestions = new Map<number, PositionSuggestion>();
  for (const s of suggestPositions(appearances, sheets)) {
    const p = byId.get(s.player_id);
    if (p && !p.position_confirmed && p.position !== s.position)
      positionSuggestions.set(s.player_id, s);
  }

  const nameSuggestions: Map<number, NameSuggestion[]> = evidence.data
    ? suggestWithheldNames(
        appearances,
        sheets,
        all.filter((p) => !p.name_withheld).map((p) => p.name),
      )
    : new Map<number, NameSuggestion[]>();

  const evidenceFor = (fixtureId: number): MatchEvidence => ({
    pitchero: withPitchero.has(fixtureId),
    potm: potm.data?.has(fixtureId) ?? false,
    unnamed: unnamed.get(fixtureId) ?? 0,
  });

  const withheld = all.filter((p) => p.name_withheld);
  const toPosition = all.filter(needsPosition);
  const toCheck = (fixtures.data ?? []).filter(needsChecking);
  const noKeeper = sidesWithoutKeeper(sides.data ?? [], all);

  // The latest time anything came in from England Hockey or Pitchero.
  const lastImport = (fixtures.data ?? [])
    .flatMap((f) => [f.lineup_imported_at, f.pitchero_imported_at])
    .filter((t): t is string => Boolean(t))
    .sort()
    .at(-1);

  return {
    loading: players.isLoading || fixtures.isLoading || sides.isLoading,
    evidenceLoading: evidence.isLoading || potm.isLoading,
    withheld,
    toPosition,
    toCheck,
    noKeeper,
    positionSuggestions,
    nameSuggestions,
    evidenceFor,
    lastImport,
  };
}
