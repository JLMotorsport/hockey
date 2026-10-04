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
