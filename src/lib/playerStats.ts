// Season totals per player from their stat lines, for the stats tables
// (Players, Transfers list). Pure so it can be unit tested.

export interface StatRow {
  player_id: number;
  goals: number;
  assists: number;
  green_cards: number;
  yellow_cards: number;
  red_cards: number;
  player_of_match: boolean;
  /** Goals the side conceded in that match; null if no score yet. */
  goals_against: number | null;
}

export interface SeasonStats {
  apps: number;
  goals: number;
  assists: number;
  potm: number;
  cleanSheets: number;
  green: number;
  yellow: number;
  red: number;
}

export const NO_STATS: SeasonStats = {
  apps: 0,
  goals: 0,
  assists: 0,
  potm: 0,
  cleanSheets: 0,
  green: 0,
  yellow: 0,
  red: 0,
};

export function seasonStats(rows: StatRow[]): Map<number, SeasonStats> {
  const out = new Map<number, SeasonStats>();
  for (const r of rows) {
    const s = { ...(out.get(r.player_id) ?? NO_STATS) };
    s.apps += 1;
    s.goals += r.goals;
    s.assists += r.assists;
    s.potm += r.player_of_match ? 1 : 0;
    s.cleanSheets += r.goals_against === 0 ? 1 : 0;
    s.green += r.green_cards;
    s.yellow += r.yellow_cards;
    s.red += r.red_cards;
    out.set(r.player_id, s);
  }
  return out;
}

export type SortDir = 'desc' | 'asc';

/** Sort by a number, highest first by default; players with no value go last. */
export function sortBy<T>(
  list: T[],
  value: (item: T) => number | null,
  dir: SortDir,
  tiebreak: (item: T) => number = () => 0,
): T[] {
  return [...list].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return tiebreak(b) - tiebreak(a);
    if (va === null) return 1;
    if (vb === null) return -1;
    return (dir === 'desc' ? vb - va : va - vb) || tiebreak(b) - tiebreak(a);
  });
}
