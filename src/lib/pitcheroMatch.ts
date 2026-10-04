import type { Position } from './scoring';

// Suggestions from Pitchero line-ups. Nothing here changes data: managers
// confirm each suggestion in the app.

/** "Thomas Rattle" and "Tom Rattle" -> "t rattle". Only compared within a match. */
export function nameKey(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '';
  return `${words[0]![0]} ${words[words.length - 1]}`;
}

export interface Appearance {
  fixture_id: number;
  player_id: number;
  name: string;
  name_withheld: boolean;
}

export interface PitcheroRow {
  fixture_id: number;
  name: string;
  position: string | null;
}

export interface NameSuggestion {
  name: string;
  /** Games where this name was on Pitchero's sheet but not England Hockey's. */
  games: number;
  of: number;
}

/**
 * For each withheld player: names on Pitchero's team sheet that England
 * Hockey doesn't account for, in every game they played. Once a player has a
 * single such name, it's taken out of the running for the others, so their
 * team-mates resolve too.
 */
export function suggestWithheldNames(
  appearances: Appearance[],
  pitchero: PitcheroRow[],
  allNamedPlayers: string[],
): Map<number, NameSuggestion[]> {
  const known = new Set(allNamedPlayers.map(nameKey));
  const namedIn = new Map<number, Set<string>>();
  const sheet = new Map<number, string[]>();
  for (const a of appearances) {
    if (a.name_withheld) continue;
    namedIn.set(a.fixture_id, (namedIn.get(a.fixture_id) ?? new Set()).add(nameKey(a.name)));
  }
  for (const p of pitchero) sheet.set(p.fixture_id, [...(sheet.get(p.fixture_id) ?? []), p.name]);

  // Unaccounted-for names per withheld player per game.
  const games = new Map<number, string[][]>();
  for (const a of appearances) {
    if (!a.name_withheld || !sheet.has(a.fixture_id)) continue;
    const accounted = namedIn.get(a.fixture_id) ?? new Set<string>();
    const left = (sheet.get(a.fixture_id) ?? []).filter((n) => {
      const key = nameKey(n);
      return !accounted.has(key) && !known.has(key);
    });
    games.set(a.player_id, [...(games.get(a.player_id) ?? []), left]);
  }

  const taken = new Set<string>();
  const result = new Map<number, NameSuggestion[]>();
  const rank = (playerId: number): NameSuggestion[] => {
    const sets = games.get(playerId) ?? [];
    const counts = new Map<string, number>();
    for (const names of sets) {
      for (const n of new Set(names)) {
        if (!taken.has(nameKey(n))) counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([name, n]) => ({ name, games: n, of: sets.length }))
      .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  };

  // Settle the clear cases first, then let them eliminate names for others.
  let progress = true;
  while (progress) {
    progress = false;
    for (const playerId of games.keys()) {
      if (result.has(playerId)) continue;
      const ranked = rank(playerId);
      const everyGame = ranked.filter((r) => r.games === r.of);
      if (everyGame.length === 1) {
        result.set(playerId, ranked);
        taken.add(nameKey(everyGame[0]!.name));
        progress = true;
      }
    }
  }
  for (const playerId of games.keys()) {
    if (!result.has(playerId)) result.set(playerId, rank(playerId));
  }
  return result;
}

/** Pitchero's line-up positions in our four. Wingers count as midfield. */
export function mapPosition(position: string | null): Position | null {
  if (!position) return null;
  const p = position.toLowerCase();
  if (p.includes('keeper')) return 'GK';
  if (/(back|sweeper|defen|centre half|half back)/.test(p)) return 'DEF';
  if (/(forward|striker|attack)/.test(p)) return 'FWD';
  if (/(mid|wing|half)/.test(p)) return 'MID';
  return null;
}

export interface PositionSuggestion {
  player_id: number;
  position: Position;
  /** e.g. "Fullback 3, Midfield 1" */
  evidence: string;
}

/** The position each named player most often lines up in on Pitchero. */
export function suggestPositions(
  appearances: Appearance[],
  pitchero: PitcheroRow[],
): PositionSuggestion[] {
  const sheetByFixture = new Map<number, PitcheroRow[]>();
  for (const p of pitchero)
    sheetByFixture.set(p.fixture_id, [...(sheetByFixture.get(p.fixture_id) ?? []), p]);
  const seen = new Map<number, string[]>();
  for (const a of appearances) {
    if (a.name_withheld) continue;
    const row = (sheetByFixture.get(a.fixture_id) ?? []).find(
      (p) => nameKey(p.name) === nameKey(a.name),
    );
    if (row?.position) seen.set(a.player_id, [...(seen.get(a.player_id) ?? []), row.position]);
  }
  const out: PositionSuggestion[] = [];
  for (const [playerId, positions] of seen) {
    const tally = new Map<Position, number>();
    for (const p of positions) {
      const mapped = mapPosition(p);
      if (mapped) tally.set(mapped, (tally.get(mapped) ?? 0) + 1);
    }
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) continue;
    const raw = new Map<string, number>();
    for (const p of positions) raw.set(p, (raw.get(p) ?? 0) + 1);
    out.push({
      player_id: playerId,
      position: best[0],
      evidence: [...raw.entries()].map(([p, n]) => `${p} ${n}`).join(', '),
    });
  }
  return out;
}
