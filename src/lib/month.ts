// Manager of the Month: each calendar month's points (by the gameweeks that
// start in it), ranked, with movement since the month's previous gameweek.
// Pure, so it can be unit tested.

export interface MonthGameweek {
  id: number;
  start_date: string;
  deadline: string;
}

export interface Month {
  /** "2026-10" */
  key: string;
  /** "October" */
  label: string;
  /** Every gameweek starting this month, oldest first. */
  gameweeks: MonthGameweek[];
}

/** The months with gameweeks in them, oldest first (from `from`, when scoring restarted). */
export function monthsOf(gameweeks: MonthGameweek[], from?: string | null): Month[] {
  const months: Month[] = [];
  for (const g of [...gameweeks].sort((a, b) => a.start_date.localeCompare(b.start_date))) {
    if (from && g.start_date < from) continue;
    const key = g.start_date.slice(0, 7);
    let m = months.at(-1);
    if (m?.key !== key) {
      m = {
        key,
        label: new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(
          new Date(`${key}-01T00:00:00Z`),
        ),
        gameweeks: [],
      };
      months.push(m);
    }
    m.gameweeks.push(g);
  }
  return months;
}

export interface Manager {
  user_id: string;
  team_name: string;
  display_name: string;
}

export interface MonthRow extends Manager {
  rank: number;
  points: number;
  /** Places up (+) or down (-) since the month's previous gameweek; 0 for none or the first. */
  move: number;
}

type Points = Map<string, Map<number, number>>;

function ranked(managers: Manager[], points: Points, ids: number[]) {
  return managers
    .map((m) => ({
      ...m,
      points: ids.reduce((sum, id) => sum + (points.get(m.user_id)?.get(id) ?? 0), 0),
    }))
    .sort(
      (a, b) =>
        b.points - a.points || a.team_name.toLowerCase().localeCompare(b.team_name.toLowerCase()),
    )
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** The month's table from the gameweeks played so far (`played`, oldest first). */
export function monthTable(managers: Manager[], points: Points, played: number[]): MonthRow[] {
  const now = ranked(managers, points, played);
  const before =
    played.length > 1
      ? new Map(ranked(managers, points, played.slice(0, -1)).map((r) => [r.user_id, r.rank]))
      : null;
  return now.map((r) => ({ ...r, move: before ? (before.get(r.user_id) ?? r.rank) - r.rank : 0 }));
}

/** The month's best single gameweek: who, how many, and which gameweek. */
export function bestGameweek(
  managers: Manager[],
  points: Points,
  played: number[],
): { manager: Manager; points: number; gameweekId: number } | null {
  let best: { manager: Manager; points: number; gameweekId: number } | null = null;
  for (const m of managers) {
    for (const id of played) {
      const p = points.get(m.user_id)?.get(id);
      if (p !== undefined && (!best || p > best.points))
        best = { manager: m, points: p, gameweekId: id };
    }
  }
  return best;
}
