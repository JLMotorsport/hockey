import type { Position } from './scoring';

// Lay out a squad on the pitch. Picked players go in their position's row and
// the empty slots fill the rows needed to make a legal 11 (1 GK, 3+ DEF,
// 3+ MID, 1+ FWD), then a 4-4-2 shape.
const MIN: Record<Position, number> = { GK: 1, DEF: 3, MID: 3, FWD: 1 };
const SHAPE: Record<Position, number> = { GK: 1, DEF: 4, MID: 4, FWD: 2 };
const FILL_ORDER: Position[] = ['GK', 'DEF', 'MID', 'FWD'];

export type Rows<T> = Record<Position, (T | null)[]>;

export function pitchRows<T extends { position: Position }>(picked: T[], size = 11): Rows<T> {
  const rows: Rows<T> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of picked) rows[p.position].push(p);
  let empty = Math.max(0, size - picked.length);

  const fillTo = (target: Record<Position, number>) => {
    for (const pos of FILL_ORDER) {
      while (empty > 0 && rows[pos].length < target[pos]) {
        rows[pos].push(null);
        empty -= 1;
      }
    }
  };
  fillTo(MIN);
  fillTo(SHAPE);
  // Anything left (only if a row went past the shape) goes in midfield.
  while (empty > 0) {
    rows.MID.push(null);
    empty -= 1;
  }
  return rows;
}
