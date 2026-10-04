import { parseFormation } from './formation';
import { POSITIONS, type Position } from './scoring';

export interface Scorer {
  player_id: number;
  name: string;
  position: Position;
  points: number;
}

export interface BestTeam {
  formation: string;
  picks: Scorer[];
  total: number;
}

/**
 * The highest-scoring 11 for a gameweek: for each allowed formation take the
 * top scorers in each position, and keep the formation with the most points.
 * Ties go to the formation listed first. If a position is short of players,
 * the team is filled as far as it can be.
 */
export function teamOfTheWeek(scorers: Scorer[], formations: string[]): BestTeam | null {
  if (!scorers.length || !formations.length) return null;
  const byPosition = Object.fromEntries(
    POSITIONS.map((pos) => [
      pos,
      scorers
        .filter((s) => s.position === pos)
        .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)),
    ]),
  ) as Record<Position, Scorer[]>;

  let best: BestTeam | null = null;
  for (const formation of formations) {
    const shape = parseFormation(formation);
    const picks = POSITIONS.flatMap((pos) => byPosition[pos].slice(0, shape[pos]));
    const total = picks.reduce((sum, p) => sum + p.points, 0);
    if (!best || total > best.total || (total === best.total && picks.length > best.picks.length)) {
      best = { formation, picks, total };
    }
  }
  return best;
}
