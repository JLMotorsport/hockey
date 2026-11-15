// Injured and unavailable players (0042): a manager flags someone Doubtful or
// Out, with a note and an optional back-by date. Information only; nothing
// here changes scoring. Pure, so it can be unit tested.
import { ukToday } from './gameweek';

export type FlagStatus = 'doubtful' | 'out';

export interface PlayerFlag {
  status: FlagStatus;
  note: string | null;
  /** UK date ("2026-12-05"); from that day the flag no longer shows. */
  back_by: string | null;
  set_at: string;
  /** Who set it (0043): a manager by hand, or the Pitchero availability upload. */
  source?: 'manager' | 'pitchero';
}

/** Still showing: no back-by date, or that date is still to come (UK time). */
export function isActive(flag: PlayerFlag, now = new Date()): boolean {
  return !flag.back_by || flag.back_by > ukToday(now);
}

const dayMonth = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});
const weekdayDayMonth = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const asDate = (day: string) => new Date(`${day}T12:00:00Z`);

/** For a list: "Out until 5 Dec", "Out", "Doubtful". */
export function flagShort(flag: PlayerFlag): string {
  const word = flag.status === 'out' ? 'Out' : 'Doubtful';
  return flag.back_by ? `${word} until ${dayMonth.format(asDate(flag.back_by))}` : word;
}

/** The headline on the player sheet: "Out: broken finger". */
export function flagHead(flag: PlayerFlag): string {
  const word = flag.status === 'out' ? 'Out' : 'Doubtful';
  return flag.note?.trim() ? `${word}: ${flag.note.trim()}` : word;
}

/** How long ago it was set: "today", "yesterday", "3 days ago", "2 weeks ago". */
export function flaggedAgo(setAt: string, now = new Date()): string {
  const days = Math.round(
    (Date.parse(`${ukToday(now)}T12:00:00Z`) -
      Date.parse(`${ukToday(new Date(setAt))}T12:00:00Z`)) /
      86_400_000,
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return `${Math.floor(days / 7)} weeks ago`;
}

/** The second line on the player sheet: "Expected back Sat 5 Dec · flagged 2 days ago". */
export function flagLine(flag: PlayerFlag, now = new Date()): string {
  const back = flag.back_by
    ? `Expected back ${weekdayDayMonth.format(asDate(flag.back_by))} · `
    : '';
  return `${back}flagged ${flaggedAgo(flag.set_at, now)}`;
}

/** A flag left with no back-by date for three weeks or more: worth a manager checking. */
export function isStale(flag: PlayerFlag, now = new Date()): boolean {
  return !flag.back_by && now.getTime() - Date.parse(flag.set_at) >= 21 * 86_400_000;
}
