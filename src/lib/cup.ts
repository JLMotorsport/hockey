// The FHC Cup: a knockout from gameweek scores. Seeded by the league table
// before it starts (top seeds get any byes), one gameweek per round, the
// higher score after transfer hits goes through, and a tie goes to the
// higher seed. Pure, so it can be unit tested.

export interface CupTie {
  /** Seeds (1 = top). Null: a bye. Undefined: still to be decided (winner of an earlier tie). */
  a: number | null | undefined;
  b: number | null | undefined;
  aPoints?: number;
  bPoints?: number;
  /** The seed going through, once known. */
  winner?: number;
}

export interface CupRound {
  name: string;
  gameweekId: number | undefined;
  ties: CupTie[];
}

/** Bracket positions for `size` (a power of two): 1 v size, 2 v size-1..., spread so 1 and 2 meet in the final. */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

export function roundName(teams: number, first: boolean): string {
  if (teams === 2) return 'Final';
  if (teams === 4) return 'Semi-finals';
  if (teams === 8) return 'Quarter-finals';
  if (teams === 16 && !first) return 'Round of 16';
  return first ? 'First round' : `Round of ${teams}`;
}

/**
 * The whole draw. `entrants`: how many are in (seeds 1..entrants).
 * `gameweeks`: one per round (undefined where the season has run out).
 * `score(seed, gameweekId)`: points that week, or undefined if none yet.
 * `decided(gameweekId)`: whether that week's scores are final.
 */
export function cupDraw(
  entrants: number,
  gameweeks: (number | undefined)[],
  score: (seed: number, gameweekId: number) => number | undefined,
  decided: (gameweekId: number) => boolean,
): CupRound[] {
  if (entrants < 2) return [];
  let size = 1;
  while (size < entrants) size *= 2;
  const order = seedOrder(size).map((s) => (s <= entrants ? s : null));
  let slots: (number | null | undefined)[] = order;
  const rounds: CupRound[] = [];
  for (let r = 0; slots.length > 1; r++) {
    const gw = gameweeks[r];
    const ties: CupTie[] = [];
    for (let i = 0; i < slots.length; i += 2) {
      const a = slots[i];
      const b = slots[i + 1];
      const tie: CupTie = { a, b };
      if (a === null && typeof b === 'number') tie.winner = b;
      else if (b === null && typeof a === 'number') tie.winner = a;
      else if (typeof a === 'number' && typeof b === 'number' && gw !== undefined) {
        tie.aPoints = score(a, gw);
        tie.bPoints = score(b, gw);
        if (decided(gw)) {
          const pa = tie.aPoints ?? 0;
          const pb = tie.bPoints ?? 0;
          tie.winner = pa > pb ? a : pb > pa ? b : Math.min(a, b);
        }
      }
      ties.push(tie);
    }
    rounds.push({ name: roundName(slots.length, r === 0), gameweekId: gw, ties });
    slots = ties.map((t) => (t.a === null && t.b === null ? null : t.winner));
  }
  return rounds;
}
