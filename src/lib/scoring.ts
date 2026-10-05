// Fantasy points rules. The database (performance_points in
// supabase/migrations/0015_away_wins.sql) is the source of truth for totals; this
// mirrors it for the rules page and per-match breakdowns. tests/unit and
// tests/integration check the two agree.

export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';
export const POSITIONS: Position[] = ['GK', 'DEF', 'MID', 'FWD'];
export const POSITION_NAMES: Record<Position, string> = {
  GK: 'Goalkeeper',
  DEF: 'Defender',
  MID: 'Midfielder',
  FWD: 'Forward',
};

export const POINTS = {
  appearance: 1,
  goal: { GK: 6, DEF: 6, MID: 5, FWD: 4 } as Record<Position, number>,
  assist: 3,
  cleanSheet: { GK: 4, DEF: 4, MID: 1, FWD: 0 } as Record<Position, number>,
  concededPerPoint: 2,
  // Away wins count double, to reward travelling.
  teamWin: { home: 1, away: 2 },
  playerOfMatch: 3,
  greenCard: -1,
  yellowCard: -2,
  redCard: -4,
  captainMultiplier: 2,
} as const;

export const RULES_TABLE: [string, string][] = [
  ['Playing in a match', '1'],
  ['Goal (GK / DEF)', '6'],
  ['Goal (MID)', '5'],
  ['Goal (FWD)', '4'],
  ['Assist', '3'],
  ['Clean sheet (GK / DEF)', '4'],
  ['Clean sheet (MID)', '1'],
  ['Every 2 goals conceded (GK / DEF)', '-1'],
  ['Team win at home', '1'],
  ['Team win away', '2'],
  ['Player of the match', '3'],
  ['Green card', '-1'],
  ['Yellow card', '-2'],
  ['Red card', '-4'],
  ['Captain', 'x2'],
];

export interface StatLine {
  position: Position;
  goals: number;
  assists: number;
  green_cards: number;
  yellow_cards: number;
  red_cards: number;
  player_of_match: boolean;
  goals_for: number | null;
  goals_against: number | null;
  /** Felixstowe at home (false: away). */
  is_home: boolean;
}

/** [reason, points] pairs for one player in one match. */
export function breakdown(s: StatLine): [string, number][] {
  const items: [string, number][] = [['Played', POINTS.appearance]];
  if (s.goals) items.push([`${s.goals} goal(s)`, s.goals * POINTS.goal[s.position]]);
  if (s.assists) items.push([`${s.assists} assist(s)`, s.assists * POINTS.assist]);

  if (s.goals_for !== null && s.goals_against !== null) {
    if (s.goals_against === 0 && POINTS.cleanSheet[s.position]) {
      items.push(['Clean sheet', POINTS.cleanSheet[s.position]]);
    }
    const lost = Math.floor(s.goals_against / POINTS.concededPerPoint);
    if ((s.position === 'GK' || s.position === 'DEF') && lost > 0) {
      items.push([`${s.goals_against} conceded`, -lost]);
    }
    if (s.goals_for > s.goals_against) {
      items.push(s.is_home ? ['Home win', POINTS.teamWin.home] : ['Away win', POINTS.teamWin.away]);
    }
  }

  if (s.player_of_match) items.push(['Player of the match', POINTS.playerOfMatch]);
  if (s.green_cards)
    items.push([`${s.green_cards} green card(s)`, s.green_cards * POINTS.greenCard]);
  if (s.yellow_cards) {
    items.push([`${s.yellow_cards} yellow card(s)`, s.yellow_cards * POINTS.yellowCard]);
  }
  if (s.red_cards) items.push([`${s.red_cards} red card(s)`, s.red_cards * POINTS.redCard]);
  return items;
}

export function points(s: StatLine): number {
  return breakdown(s).reduce((sum, [, p]) => sum + p, 0);
}
