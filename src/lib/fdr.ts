// Fixture difficulty, as FPL's, from the gap between the two teams in their
// league table (our sides are all in different leagues, so the opponent's
// place alone says little). At home: well below us 1, below or level 2,
// above us 3, well above us 4, where "well" is more than a third of the
// table (so 2nd v 5th of 11 is just "below", a 2). An away game adds 1, so only a much stronger side away is a 5.
// Without our place, the opponent's quarter of the table is used instead.
// Pure, so it can be unit tested.

export type Difficulty = 1 | 2 | 3 | 4 | 5;

/** 1 (easiest) to 5 (hardest) for an opponent `position` of `teams`, with us at `ours`. */
export function difficulty(
  position: number,
  teams: number,
  isHome: boolean,
  ours: number | null = null,
): Difficulty | null {
  const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= teams;
  if (!Number.isInteger(teams) || teams < 1 || !valid(position)) return null;
  let home: number;
  if (ours !== null && valid(ours)) {
    // Positive: they're above us.
    const gap = ours - position;
    const third = teams / 3;
    home = gap > third ? 4 : gap > 0 ? 3 : gap >= -third ? 2 : 1;
  } else {
    home = 4 - Math.floor(((position - 1) * 4) / teams);
  }
  return (home + (isHome ? 0 : 1)) as Difficulty;
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
  /** Our side's place in the same table, when the sync found it. */
  ours: number | null;
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
      rating: place ? difficulty(place.position, place.teams, f.is_home, place.ours) : null,
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

/** "Home · 3rd, we're 8th of 12", "Away (+1) · 9th of 10" */
export function placeLine(home: boolean, place: FdrPlace | undefined): string {
  const where = home ? 'Home' : 'Away (+1)';
  if (!place) return where;
  return place.ours
    ? `${where} · ${ordinal(place.position)}, we're ${ordinal(place.ours)} of ${place.teams}`
    : `${where} · ${ordinal(place.position)} of ${place.teams}`;
}
