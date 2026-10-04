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
}

export interface SquadSummary {
  count: number;
  cost: number;
  byPosition: Record<Position, number>;
  /** Null when there's no earlier squad (the first squad is free). */
  transfers: number | null;
  problems: string[];
}

export function summariseSquad(
  picked: SquadPlayer[],
  captainId: number | null,
  settings: SquadSettings,
  current: number[],
  previous: number[],
): SquadSummary {
  const byPosition: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  const perSide = new Map<string, number>();
  let cost = 0;
  for (const p of picked) {
    byPosition[p.position] += 1;
    perSide.set(p.side_name, (perSide.get(p.side_name) ?? 0) + 1);
    cost += p.price;
  }

  const ids = picked.map((p) => p.id);
  const unchanged = ids.length === current.length && ids.every((id) => current.includes(id));
  const transfers = previous.length ? ids.filter((id) => !previous.includes(id)).length : null;

  const problems: string[] = [];
  if (picked.length !== settings.squad_size) {
    problems.push(`Pick exactly ${settings.squad_size} players (you have ${picked.length}).`);
  }
  for (const p of picked) {
    if (!p.active && !current.includes(p.id))
      problems.push(`${p.name} isn't available for selection.`);
  }
  if (byPosition.GK !== 1) problems.push('Pick exactly 1 goalkeeper.');
  if (byPosition.DEF < 3) problems.push('Pick at least 3 DEF.');
  if (byPosition.MID < 3) problems.push('Pick at least 3 MID.');
  if (byPosition.FWD < 1) problems.push('Pick at least 1 FWD.');
  if (cost > settings.budget && !unchanged) {
    problems.push(
      `Squad costs ${formatPrice(cost)}m, over the ${formatPrice(settings.budget)}m budget.`,
    );
  }
  for (const [side, n] of perSide) {
    if (n > settings.max_per_side) {
      problems.push(`Max ${settings.max_per_side} players from ${side} (you have ${n}).`);
    }
  }
  if (captainId === null || !ids.includes(captainId))
    problems.push('Choose a captain from your squad.');
  if (transfers !== null && transfers > settings.transfers_per_gameweek) {
    problems.push(
      `That's ${transfers} transfers; only ${settings.transfers_per_gameweek} allowed per gameweek.`,
    );
  }
  return { count: picked.length, cost, byPosition, transfers, problems };
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
