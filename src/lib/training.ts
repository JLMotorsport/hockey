// Training points (0044) from Pitchero's track and trace export: who checked
// in to General Club Training. Each day trained between one gameweek's
// deadline and the next is a point for that gameweek, at most 2. The same
// rule as training_points() in the database. Pure, so it can be unit tested.
import { parseCsv } from './pitcheroAvailability';

export const TRAINING_EVENT = /general club training/i;
export const TRAINING_CAP = 2;

export interface CheckIn {
  /** UK date, "2026-11-10". */
  date: string;
  time: string;
  event: string;
  name: string;
}

/** Every check-in in a track and trace export. Throws for any other file. */
export function readCheckIns(text: string): CheckIn[] {
  const [head, ...body] = parseCsv(text);
  const col = (name: string) => (head ?? []).findIndex((h) => h.trim().toLowerCase() === name);
  const [date, time, event, first, last] = ['date', 'time', 'event', 'firstname', 'lastname'].map(
    col,
  );
  if ([date, event, first, last].some((i) => i === undefined || i < 0))
    throw new Error('This isn’t a Pitchero track and trace export.');
  return body
    .map((r) => ({
      date: (r[date!] ?? '').trim(),
      time: (r[time!] ?? '').trim(),
      event: (r[event!] ?? '').trim(),
      name: `${(r[first!] ?? '').trim()} ${(r[last!] ?? '').trim()}`.trim(),
    }))
    .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date) && c.name);
}

/** The check-ins that count: General Club Training only. */
export const countedCheckIns = (all: CheckIn[]) => all.filter((c) => TRAINING_EVENT.test(c.event));

/** A name as an alias key: letters only, lower case (as player_aliases). */
export const aliasKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');

/**
 * The gameweek a training day counts for: the first whose deadline day is on
 * or after it, among those after the previous deadline day.
 */
export function gameweekForDay<G extends { id: number; deadline: string }>(
  day: string,
  gameweeks: G[],
  ukDate: (iso: string) => string,
): G | undefined {
  return [...gameweeks]
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .find((g) => ukDate(g.deadline) >= day);
}

/** Points from the days trained in a gameweek's window, as training_points(). */
export function trainingPoints(days: string[], after: string | null, upTo: string): number {
  const inWindow = new Set(days.filter((d) => d <= upTo && (after === null || d > after)));
  return Math.min(TRAINING_CAP, inWindow.size);
}

const words = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/);
/** Three letters in a row in common: Becky / Rebecca ("bec"), Tabby / Tabitha ("tab"). */
const shareThree = (a: string, b: string) => {
  for (let i = 0; i + 3 <= a.length; i++) if (b.includes(a.slice(i, i + 3))) return true;
  return false;
};
/** Same surname, and first names that are plausibly one person's (for a suggestion only). */
export function likelySame(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (x.length < 2 || y.length < 2 || x.at(-1) !== y.at(-1)) return false;
  return x[0]![0] === y[0]![0] || shareThree(x[0]!, y[0]!);
}
