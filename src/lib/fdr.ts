// Fixture difficulty, as FPL's, from the opponent's place in their league
// table: top quarter 4 down to bottom quarter 1, and an away game adds 1, so
// only a top side away is a 5. Pure, so it can be unit tested.

export type Difficulty = 1 | 2 | 3 | 4 | 5;

/** 1 (easiest) to 5 (hardest) for an opponent `position` of `teams`. */
export function difficulty(position: number, teams: number, isHome: boolean): Difficulty | null {
  if (!Number.isInteger(position) || !Number.isInteger(teams) || teams < 1) return null;
  if (position < 1 || position > teams) return null;
  const quarter = 4 - Math.floor(((position - 1) * 4) / teams);
  return (quarter + (isHome ? 0 : 1)) as Difficulty;
}

/** FPL's colours for each rating, with text that reads on them. */
export const FDR_COLOURS: Record<Difficulty, { bg: string; fg: string }> = {
  1: { bg: '#1b6e41', fg: '#ffffff' },
  2: { bg: '#4fd18b', fg: '#0e1014' },
  3: { bg: '#d6d9df', fg: '#0e1014' },
  4: { bg: '#e8506b', fg: '#ffffff' },
  5: { bg: '#8c1c34', fg: '#ffffff' },
};

/** Three letters for a chip: "Cambridge South 1" -> "CAS", "Ipswich-East Suffolk 2" -> "IES". */
export function opponentCode(name: string): string {
  const clean = name
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^ipswich\s*(?:-|&|and)?\s*east suffolk\b/i, 'IES')
    .replace(/^university of east anglia\b/i, 'UEA')
    .replace(/^city of /i, '');
  const words = clean
    .split(/[\s-]+/)
    .filter((w) => w && !/^\d+$/.test(w) && !/^(of|the|hc|hockey|club|development|dev)$/i.test(w));
  if (!words.length) return clean.slice(0, 3).toUpperCase();
  if (/^[A-Z]{3}$/.test(words[0]!)) return words[0]!;
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase();
  return (words[0]!.slice(0, 2) + words[1]!.slice(0, 1)).toUpperCase();
}

export interface FdrFixture {
  id: number;
  side_id: number;
  gameweek_id: number;
  opponent: string;
  is_home: boolean;
}

export interface FdrPlace {
  position: number;
  teams: number;
}

export interface RunCell {
  /** "CAS", or null for no game that gameweek. */
  code: string | null;
  opponent: string | null;
  home: boolean;
  /** Null for no game, or an opponent not in the side's league (a cup tie). */
  rating: Difficulty | null;
  place: FdrPlace | null;
}

/** A side's games over the given gameweeks (oldest first), one cell each. */
export function sideRun(
  fixtures: FdrFixture[],
  sideId: number,
  gameweekIds: number[],
  places: Map<number, FdrPlace>,
): RunCell[] {
  return gameweekIds.map((gw) => {
    const f = fixtures.find((x) => x.side_id === sideId && x.gameweek_id === gw);
    if (!f) return { code: null, opponent: null, home: false, rating: null, place: null };
    const place = places.get(f.id) ?? null;
    return {
      code: opponentCode(f.opponent),
      opponent: f.opponent,
      home: f.is_home,
      rating: place ? difficulty(place.position, place.teams, f.is_home) : null,
      place,
    };
  });
}

/** How easy a run is, for sorting (higher is easier); null with nothing rated. */
export function runEase(run: RunCell[]): number | null {
  const rated = run.filter((c) => c.rating !== null);
  if (!rated.length) return null;
  // Blank weeks count as hard: a player with no game scores nothing.
  return run.reduce((sum, c) => sum + (c.code === null ? 0 : 6 - (c.rating ?? 3)), 0);
}

/** "3rd" */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** "Home · 3rd of 10", "Away (+1) · 9th of 10" */
export function placeLine(home: boolean, place: FdrPlace | undefined): string {
  const where = home ? 'Home' : 'Away (+1)';
  return place ? `${where} · ${ordinal(place.position)} of ${place.teams}` : where;
}
