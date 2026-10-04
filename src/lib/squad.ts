import { formationOf } from './formation';
import type { Position } from './scoring';

// Live summary for the squad picker. save_squad() in the database enforces the
// same rules; this only tells people what's wrong before they press save.

export interface SquadPlayer {
  id: number;
  name: string;
  position: Position;
  side_id: number;
  side_name: string;
  price: number;
  active: boolean;
}

export interface SquadSettings {
  budget: number;
  squad_size: number;
  max_per_side: number;
  transfers_per_gameweek: number;
  formations: string[];
}

/** Money going into this gameweek: the bank, and today's price of anyone sold. */
export interface Funds {
  base: number;
  priceOf: (playerId: number) => number;
}

export interface SquadSummary {
  /** Starters plus subs picked so far (out of 15). */
  count: number;
  cost: number;
  /** Bank after this week's sales and buys, in tenths. Negative means over. */
  bank: number;
  /** The starting 11 only. */
  byPosition: Record<Position, number>;
  /** Null when there's no earlier squad (the first squad is free). */
  transfers: number | null;
  problems: string[];
}

export const STARTERS = 11;
export const BENCH = 4;

/**
 * starters: the 11. bench: [sub keeper, sub 1, sub 2, sub 3], null where
 * empty. current: everyone in the saved squad; currentStarters: its 11 (an
 * unchanged 11 keeps an old formation). previous: last gameweek's squad.
 */
export function summariseSquad(
  starters: SquadPlayer[],
  bench: (SquadPlayer | null)[],
  captainId: number | null,
  viceId: number | null,
  settings: SquadSettings,
  current: number[],
  previous: number[],
  funds: Funds = { base: settings.budget, priceOf: () => 0 },
  currentStarters: number[] = current,
): SquadSummary {
  const byPosition: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const p of starters) byPosition[p.position] += 1;
  const subs = bench.filter((p): p is SquadPlayer => p !== null);
  const picked = [...starters, ...subs];
  const perSide = new Map<string, number>();
  let cost = 0;
  for (const p of picked) {
    perSide.set(p.side_name, (perSide.get(p.side_name) ?? 0) + 1);
    cost += p.price;
  }

  const ids = picked.map((p) => p.id);
  const starterIds = starters.map((p) => p.id);
  const unchanged =
    starterIds.length === currentStarters.length &&
    starterIds.every((id) => currentStarters.includes(id));
  // A squad from before the bench existed fills up to 15 for free.
  const transfers = previous.length
    ? Math.max(
        0,
        ids.filter((id) => !previous.includes(id)).length -
          Math.max(0, STARTERS + BENCH - previous.length),
      )
    : null;

  const problems: string[] = [];
  if (starters.length !== STARTERS) {
    problems.push(`Pick ${STARTERS} starters (you have ${starters.length}).`);
  }
  if (subs.length !== BENCH) problems.push(`Pick ${BENCH} subs (you have ${subs.length}).`);
  for (const p of picked) {
    if (!p.active && !current.includes(p.id))
      problems.push(`${p.name} isn't available for selection.`);
  }
  if (byPosition.GK !== 1) problems.push('Start exactly 1 goalkeeper.');
  const shape = formationOf(byPosition);
  if (starters.length === STARTERS && !settings.formations.includes(shape) && !unchanged) {
    problems.push(`That's a ${shape}. Pick one of: ${settings.formations.join(', ')}.`);
  }
  if (bench[0] && bench[0].position !== 'GK') problems.push('The first sub must be a goalkeeper.');
  if (bench.slice(1).some((p) => p?.position === 'GK'))
    problems.push('Subs 1 to 3 must be outfield players.');
  // Sell at today's price, buy at today's price (as in save_squad).
  const sold = previous.filter((id) => !ids.includes(id));
  const bought = picked.filter((p) => !previous.includes(p.id));
  const bank =
    funds.base +
    sold.reduce((sum, id) => sum + funds.priceOf(id), 0) -
    bought.reduce((sum, p) => sum + p.price, 0);
  if (bank < 0) {
    problems.push(`That's ${formatPrice(-bank)}m more than you can spend.`);
  }
  for (const [side, n] of perSide) {
    if (n > settings.max_per_side) {
      problems.push(`Max ${settings.max_per_side} players from ${side} (you have ${n}).`);
    }
  }
  if (captainId === null || !starterIds.includes(captainId))
    problems.push('Choose a captain from your starting 11.');
  if (viceId === null || !starterIds.includes(viceId) || viceId === captainId)
    problems.push('Choose a vice-captain from your starting 11 (not the captain).');
  if (transfers !== null && transfers > settings.transfers_per_gameweek) {
    problems.push(
      `That's ${transfers} transfers; only ${settings.transfers_per_gameweek} allowed per gameweek.`,
    );
  }
  return { count: picked.length, cost, bank, byPosition, transfers, problems };
}

/** 85 -> "8.5" */
export function formatPrice(tenths: number): string {
  return (tenths / 10).toFixed(1);
}

/** "8.5" -> 85, or null if it isn't a sensible price. */
export function parsePrice(text: string, max = 500): number | null {
  const value = Math.round(Number(text.trim()) * 10);
  if (!Number.isFinite(value) || value <= 0 || value > max) return null;
  return value;
}

/** Squad slots per position on the transfers page, as in FPL; fits every formation in the list. */
export const SQUAD_QUOTA: Record<Position, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };

export interface Arrangement {
  starters: number[];
  /** [sub keeper, sub 1, sub 2, sub 3] */
  bench: number[];
}

function shapeCounts(shape: string): [number, number, number] {
  const [d, m, f] = shape.split('-').map(Number);
  return [d ?? 0, m ?? 0, f ?? 0];
}

/** Is this a starting 11 and bench save_squad would accept (shape-wise)? */
export function isValidArrangement(
  starters: SquadPlayer[],
  bench: (SquadPlayer | null)[],
  formations: string[],
): boolean {
  if (starters.length !== STARTERS || bench.length !== BENCH || bench.some((p) => !p)) return false;
  const counts: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const p of starters) counts[p.position] += 1;
  if (counts.GK !== 1) return false;
  if (bench[0]!.position !== 'GK' || bench.slice(1).some((p) => p!.position === 'GK')) return false;
  return formations.includes(formationOf(counts));
}

/**
 * Lay out 15 players as a starting 11 and bench: one keeper starts, the
 * other is sub keeper, and the outfield 10 fit an allowed formation (the one
 * `prefer` already lines up in when possible). Players earlier in `order`
 * start first. Null when no allowed formation fits.
 */
export function autoArrange(
  players: SquadPlayer[],
  formations: string[],
  order: number[] = [],
): Arrangement | null {
  if (players.length !== STARTERS + BENCH) return null;
  const rank = (id: number) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  const by = (pos: Position) =>
    players.filter((p) => p.position === pos).sort((a, b) => rank(a.id) - rank(b.id));
  const gk = by('GK');
  if (gk.length !== 2) return null;
  const pools = { DEF: by('DEF'), MID: by('MID'), FWD: by('FWD') };
  // The shape the preferred starters already make, then the league's order.
  const preferred = players.filter((p) => rank(p.id) < STARTERS && p.position !== 'GK');
  const counts: Record<Position, number> = { GK: 1, DEF: 0, MID: 0, FWD: 0 };
  for (const p of preferred) counts[p.position] += 1;
  const current = formationOf(counts);
  const shapes = [current, ...formations.filter((f) => f !== current)].filter((f) =>
    formations.includes(f),
  );
  for (const shape of shapes) {
    const [d, m, f] = shapeCounts(shape);
    if (pools.DEF.length < d || pools.MID.length < m || pools.FWD.length < f) continue;
    const starters = [
      gk[0]!,
      ...pools.DEF.slice(0, d),
      ...pools.MID.slice(0, m),
      ...pools.FWD.slice(0, f),
    ];
    const subs = [...pools.DEF.slice(d), ...pools.MID.slice(m), ...pools.FWD.slice(f)].sort(
      (a, b) => rank(a.id) - rank(b.id),
    );
    if (subs.length !== BENCH - 1) continue;
    return { starters: starters.map((p) => p.id), bench: [gk[1]!.id, ...subs.map((p) => p.id)] };
  }
  return null;
}
