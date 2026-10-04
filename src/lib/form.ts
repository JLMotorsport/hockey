// What helps pick a player: does their side play this gameweek, against
// whom, and how have they been scoring lately.

export interface FixtureLike {
  side_id: number;
  gameweek_id: number;
  opponent: string;
  is_home: boolean;
}

/** Clubs everyone knows by their initials: "Ipswich-East Suffolk 2" -> "IES 2". */
const KNOWN_AS: [RegExp, string][] = [
  [/^ipswich\s*(?:-|&|and)?\s*east suffolk\b/i, 'IES'],
  [/^university of east anglia(?:\s+(?:mens|ladies|womens))?\b/i, 'UEA'],
];

/** The opponent as the club says it: full name, but IES and UEA. */
export function opponentName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  for (const [pattern, short] of KNOWN_AS) {
    if (pattern.test(trimmed)) return trimmed.replace(pattern, short);
  }
  return trimmed;
}

/** For pitch plates: "City Of Peterborough 2" -> "Peterborough 2", "Lowestoft Railway 1" -> "Lowestoft 1". */
export function shortOpponent(name: string): string {
  const trimmed = opponentName(name)
    .replace(/^city of /i, '')
    .replace(/\s+(hockey club|hc)\b/i, '')
    .replace(/\s+development$/i, ' Dev');
  if (trimmed.length <= 14) return trimmed;
  const words = trimmed.split(' ');
  // Keep the club's first word, its team number and any "Dev".
  const number = words.find((w) => /^\d+$/.test(w));
  const dev = words.at(-1) === 'Dev' ? ' Dev' : '';
  return number ? `${words[0]} ${number}${dev}` : words[0]!;
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

export type Result = 'W' | 'D' | 'L';

export interface ResultLike {
  side_id: number;
  kickoff: string;
  goals_for: number | null;
  goals_against: number | null;
}

/** A Felixstowe side's last `n` results, oldest first. */
export function sideForm(fixtures: ResultLike[], sideId: number, n = 5): Result[] {
  return fixtures
    .filter((f) => f.side_id === sideId && f.goals_for !== null && f.goals_against !== null)
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff))
    .slice(-n)
    .map((f) =>
      f.goals_for! > f.goals_against! ? 'W' : f.goals_for! < f.goals_against! ? 'L' : 'D',
    );
}
