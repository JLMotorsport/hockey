// Which gameweek My Team opens on.

export interface GameweekLike {
  id: number;
  start_date: string; // the Saturday, "2026-10-10"
  deadline: string;
}

/** Today's date in the UK, "2026-10-12". */
export function ukToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Over the weekend, the gameweek being played (its points coming in); from
 * the Monday, the next gameweek (the team set for it). Gameweeks in order.
 */
export function defaultGameweek<T extends GameweekLike>(
  gameweeks: T[],
  now = new Date(),
): T | undefined {
  const locked = gameweeks.filter((g) => new Date(g.deadline) <= now);
  const next = gameweeks.find((g) => new Date(g.deadline) > now);
  const last = locked.at(-1);
  if (last && ukToday(now) < addDays(last.start_date, 2)) return last;
  return next ?? last;
}
