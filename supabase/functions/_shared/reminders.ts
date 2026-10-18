// When deadline reminders are due and what they say. Pure TS, shared with
// vitest (tests/unit/reminders.test.ts) and the reminders Edge Function.

export type ReminderKind = 'eve' | 'soon';

/** The date ("2026-10-23") and hour (0-23) in the UK for an instant. */
export function ukTime(at: Date): { date: string; hour: number; clock: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    clock: `${parts.hour}:${parts.minute}`,
  };
}

function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Which reminder is due now, if any. The job runs once an hour, a few minutes
 * past: 'eve' from 7pm to 9:59pm (UK) the day before the deadline (it goes at
 * 7pm; the later hours are a retry if that run failed: reminder_log keeps it
 * to once), 'soon' when the deadline is 20 to 85 minutes away.
 */
export function dueKind(now: Date, deadline: Date): ReminderKind | null {
  const minutes = (deadline.getTime() - now.getTime()) / 60_000;
  if (minutes >= 20 && minutes <= 85) return 'soon';
  const here = ukTime(now);
  if (here.hour >= 19 && here.hour <= 21 && ukTime(deadline).date === nextDay(here.date))
    return 'eve';
  return null;
}

export interface ReminderTarget {
  has_squad: boolean;
  free: number;
  no_game: string[];
}

/** The notification's title and text for one manager. */
export function reminderText(
  kind: ReminderKind,
  gameweek: number,
  deadline: Date,
  t: ReminderTarget,
): { title: string; body: string } {
  const title =
    kind === 'eve'
      ? `GW${gameweek} deadline tomorrow, ${ukTime(deadline).clock}`
      : `GW${gameweek} deadline in an hour`;
  if (!t.has_squad) {
    return { title, body: "You haven't picked a team yet. It only takes a minute." };
  }
  const parts = [`${t.free} free transfer${t.free === 1 ? '' : 's'}`];
  if (t.no_game.length) {
    const n = t.no_game.length;
    parts.push(
      `${n} of your starters ${n === 1 ? 'has' : 'have'} no game: ${t.no_game.slice(0, 3).join(', ')}${n > 3 ? '…' : ''}`,
    );
  }
  return { title, body: `${parts.join('. ')}.` };
}
