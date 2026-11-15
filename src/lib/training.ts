// Training points (0044) from Pitchero's track and trace export: who checked
// in to a training session (two on Tuesday, one on Thursday, two on Sunday).
// Each session trained between one gameweek's deadline and the next is a point
// for that gameweek, at most 5 (0048). The same rule as training_points() in
// the database. Pure, so it can be unit tested.
import { parseCsv } from './pitcheroAvailability';

export const TRAINING_CAP = 5;

export interface CheckIn {
  /** UK date, "2026-11-10". */
  date: string;
  time: string;
  /** Pitchero's type: "training", or a match or event. */
  type: string;
  event: string;
  name: string;
}

/** Every check-in in a track and trace export. Throws for any other file. */
export function readCheckIns(text: string): CheckIn[] {
  const [head, ...body] = parseCsv(text);
  const col = (name: string) => (head ?? []).findIndex((h) => h.trim().toLowerCase() === name);
  const [date, time, type, event, first, last] = [
    'date',
    'time',
    'type',
    'event',
    'firstname',
    'lastname',
  ].map(col);
  if ([date, event, first, last].some((i) => i === undefined || i < 0))
    throw new Error('This isn’t a Pitchero track and trace export.');
  return body
    .map((r) => ({
      date: (r[date!] ?? '').trim(),
      time: (r[time!] ?? '').trim(),
      type: type !== undefined && type >= 0 ? (r[type] ?? '').trim() : '',
      event: (r[event!] ?? '').trim(),
      name: `${(r[first!] ?? '').trim()} ${(r[last!] ?? '').trim()}`.trim(),
    }))
    .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date) && c.name);
}

/** The club's own sides in an event name: "FHC Mens 2nd XI", "FhC 1s", "Felixstowe 3". */
const ours = (side: string) => /^\s*(fhc|felixstowe)\b/i.test(side);

/**
 * An internal game on a Tuesday training night ("FHC Mens 3rd XI vs FHC
 * Womens 1st XI (h)"): it was that session for the people playing, so it
 * counts. Saturday league games, even club against club, don't.
 */
export function internalTuesdayGame(c: CheckIn): boolean {
  if (new Date(`${c.date}T12:00:00Z`).getUTCDay() !== 2) return false;
  const sides = c.event.split(/\s+vs?\.?\s+/i);
  return sides.length === 2 && sides.every(ours);
}

/** The check-ins that count: training (Pitchero's type "training") and Tuesday internal games. */
export const countedCheckIns = (all: CheckIn[]) =>
  all.filter(
    (c) =>
      (c.type ? /^training$/i.test(c.type) : /training/i.test(c.event)) || internalTuesdayGame(c),
  );

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

/** One session trained: a UK date and which session that day (1 = the earlier). */
export interface Session {
  trained_on: string;
  session: number;
}

/** Points from the sessions trained in a gameweek's window, as training_points(). */
export function trainingPoints(sessions: Session[], after: string | null, upTo: string): number {
  const inWindow = new Set(
    sessions
      .filter((s) => s.trained_on <= upTo && (after === null || s.trained_on > after))
      .map((s) => `${s.trained_on}#${s.session}`),
  );
  return Math.min(TRAINING_CAP, inWindow.size);
}

/** "19:00" as minutes after midnight. */
const minutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Which session each check-in was: per day, the earliest start is session 1,
 * and a start more than 30 minutes after the session before is the next one
 * (so 20:00 training and a 20:15 game are both the 2nd). A check-in without a
 * time is session 1.
 */
export function withSessions<C extends { date: string; time: string }>(
  checkIns: C[],
): (C & { session: number })[] {
  const byDay = new Map<string, Map<string, number>>();
  for (const day of new Set(checkIns.map((c) => c.date))) {
    const times = [...new Set(checkIns.filter((c) => c.date === day && c.time).map((c) => c.time))];
    times.sort((a, b) => minutes(a) - minutes(b));
    const session = new Map<string, number>();
    let n = 0;
    let start = -Infinity;
    for (const t of times) {
      if (minutes(t) - start > 30) {
        n += 1;
        start = minutes(t);
      }
      session.set(t, n);
    }
    byDay.set(day, session);
  }
  return checkIns.map((c) => ({ ...c, session: byDay.get(c.date)?.get(c.time) ?? 1 }));
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

/** The club's training days: Sunday, Tuesday and Thursday (getUTCDay numbers). */
export const TRAINING_WEEKDAYS = [0, 2, 4];

/** Sessions a day: two on Sunday and Tuesday, one on Thursday or any other day. */
export function sessionsOn(day: string, seen = 0): number {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return Math.max(weekday === 0 || weekday === 2 ? 2 : 1, seen);
}

/**
 * The scheduled training days in a gameweek's window: after the previous
 * deadline's day, up to and including this one's (UK dates). With no previous
 * gameweek, the week before.
 */
export function scheduledDays(after: string | null, upTo: string): string[] {
  const end = Date.parse(`${upTo}T12:00:00Z`);
  const start = after ? Date.parse(`${after}T12:00:00Z`) : end - 7 * 86_400_000;
  const out: string[] = [];
  for (let t = start + 86_400_000; t <= end; t += 86_400_000) {
    const d = new Date(t);
    if (TRAINING_WEEKDAYS.includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
