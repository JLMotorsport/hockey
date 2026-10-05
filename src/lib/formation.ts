import type { Position } from './scoring';

// Formations are "defenders-midfielders-forwards", always with 1 goalkeeper.
// Every formation the manager can allow: the ones a 2 GK, 5 DEF, 5 MID, 3 FWD
// squad can field (matches the check in supabase/migrations/0016_review_fixes.sql),
// and the default set.
export const ALL_FORMATIONS = [
  '4-4-2',
  '4-3-3',
  '3-4-3',
  '3-5-2',
  '5-3-2',
  '4-5-1',
  '5-4-1',
  '5-2-3',
] as const;
export const DEFAULT_FORMATIONS = ['4-4-2', '4-3-3', '3-4-3', '3-5-2', '5-3-2', '4-5-1', '5-4-1'];

export type Shape = Record<Position, number>;

export function parseFormation(formation: string): Shape {
  const [def, mid, fwd] = formation.split('-').map(Number);
  return { GK: 1, DEF: def ?? 4, MID: mid ?? 4, FWD: fwd ?? 2 };
}

export function formationOf(counts: Record<Position, number>): string {
  return `${counts.DEF}-${counts.MID}-${counts.FWD}`;
}

export type Rows<T> = Record<Position, (T | null)[]>;

/**
 * Lay out a squad on the pitch in a formation: each line gets that many
 * slots, picked players first, empty shirts for the rest. Players beyond the
 * formation's count (after switching formation) stay visible so they can be
 * removed.
 */
export function pitchRows<T extends { position: Position }>(
  picked: T[],
  formation = '4-4-2',
): Rows<T> {
  const shape = parseFormation(formation);
  const rows: Rows<T> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of picked) rows[p.position].push(p);
  for (const pos of Object.keys(rows) as Position[]) {
    while (rows[pos].length < shape[pos]) rows[pos].push(null);
  }
  return rows;
}

/** How many players to drop from each line to fit the formation. */
export function overflow(
  counts: Record<Position, number>,
  formation: string,
): Partial<Record<Position, number>> {
  const shape = parseFormation(formation);
  const out: Partial<Record<Position, number>> = {};
  for (const pos of Object.keys(shape) as Position[]) {
    if (counts[pos] > shape[pos]) out[pos] = counts[pos] - shape[pos];
  }
  return out;
}
