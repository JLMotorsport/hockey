export interface TableRow {
  user_id: string;
  total: number;
  latest: number;
  rank: number;
}

/**
 * Places each team moved since the gameweek before (positive is up): ranks
 * on total minus the latest gameweek, against the current rank.
 */
export function movement(rows: TableRow[]): Map<string, number> {
  const before = [...rows].sort((a, b) => b.total - b.latest - (a.total - a.latest));
  const prev = new Map(before.map((r, i) => [r.user_id, i + 1]));
  return new Map(rows.map((r) => [r.user_id, (prev.get(r.user_id) ?? r.rank) - r.rank]));
}

export interface SideLike {
  id: number;
  name: string;
  short_name: string;
}

/** Mini leagues: overall, Men's, Women's and one per side. */
export type LeagueKey = 'all' | 'men' | 'women' | `side:${number}`;

/** Who is in a mini league, from the side each manager says they play for. */
export function inLeague(
  key: LeagueKey,
  sideOf: Map<string, number | null>,
  sides: SideLike[],
): (userId: string) => boolean {
  if (key === 'all') return () => true;
  const side = (userId: string) => sides.find((s) => s.id === sideOf.get(userId));
  if (key === 'men') return (u) => /^m/i.test(side(u)?.short_name ?? '');
  if (key === 'women') return (u) => /^w/i.test(side(u)?.short_name ?? '');
  const id = Number(key.slice(5));
  return (u) => sideOf.get(u) === id;
}

/** Rows of the overall table that are in a league, ranked again from 1. */
export function leagueRows<T extends TableRow>(
  rows: T[],
  include: (userId: string) => boolean,
): T[] {
  return rows.filter((r) => include(r.user_id)).map((r, i) => ({ ...r, rank: i + 1 }));
}
