// What helps pick a player: does their side play this gameweek, against
// whom, and how have they been scoring lately.

export interface FixtureLike {
  side_id: number;
  gameweek_id: number;
  opponent: string;
  is_home: boolean;
}

/** "City Of Peterborough 2" -> "Peterborough 2"; long names keep word one and the team number. */
export function shortOpponent(name: string): string {
  const trimmed = name
    .replace(/^city of /i, '')
    .replace(/\s+(hockey club|hc)\b/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (trimmed.length <= 14) return trimmed;
  const words = trimmed.split(' ');
  const last = words.at(-1)!;
  return /^\d+$/.test(last) ? `${words[0]} ${last}` : words[0]!;
}

/** "Ipswich 2 (H)", "2 games" or "No game" for a side in a gameweek. */
export function fixtureLabel(fixtures: FixtureLike[], sideId: number, gameweekId: number): string {
  const games = fixtures.filter((f) => f.side_id === sideId && f.gameweek_id === gameweekId);
  if (!games.length) return 'No game';
  if (games.length > 1) return `${games.length} games`;
  const f = games[0]!;
  return `${shortOpponent(f.opponent)} (${f.is_home ? 'H' : 'A'})`;
}

export interface GameweekPoints {
  player_id: number;
  gameweek_id: number;
  points: number;
}

/**
 * Average points over each player's last `games` gameweeks played (in the
 * order of `gameweekOrder`), to one decimal place.
 */
export function formByPlayer(
  rows: GameweekPoints[],
  gameweekOrder: number[],
  games = 3,
): Map<number, number> {
  const position = new Map(gameweekOrder.map((id, i) => [id, i]));
  const byPlayer = new Map<number, GameweekPoints[]>();
  for (const r of rows) {
    if (!position.has(r.gameweek_id)) continue;
    byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) ?? []), r]);
  }
  const out = new Map<number, number>();
  for (const [player, list] of byPlayer) {
    const recent = list
      .sort((a, b) => position.get(b.gameweek_id)! - position.get(a.gameweek_id)!)
      .slice(0, games);
    const avg = recent.reduce((sum, r) => sum + r.points, 0) / recent.length;
    out.set(player, Math.round(avg * 10) / 10);
  }
  return out;
}
