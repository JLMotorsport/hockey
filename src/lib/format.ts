// Everything at the club happens in UK time, whatever the viewer's device says.
const UK = 'Europe/London';

const dayTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const shortDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK,
  day: '2-digit',
  month: 'short',
});
const weekdayTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDayTime(iso: string): string {
  return dayTime.format(new Date(iso));
}

export function formatWeekdayTime(iso: string): string {
  return weekdayTime.format(new Date(iso));
}

/** "2026-09-12" (a date column) -> "12 Sep" */
export function formatShortDate(day: string): string {
  return shortDate.format(new Date(`${day}T12:00:00Z`));
}

/** A timestamp as the value for an <input type="datetime-local">, in UK time. */
export function toUkInputValue(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: UK,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export interface GameweekLike {
  id: number;
  start_date: string;
  deadline: string;
}

/** GW numbers come from date order, so they stay right when a cup week is added. */
export function gameweekLabel(gw: GameweekLike, all: GameweekLike[]): string {
  const number = all.filter((g) => g.start_date <= gw.start_date).length;
  return `GW${number} (${formatShortDate(gw.start_date)})`;
}

/** "Jamie Smith" -> "J. Smith" so names fit under a shirt. */
export function shortName(name: string): string {
  // "Name withheld #5 (M3)" -> "Withheld #5"
  const withheld = /^name withheld\s*(#\S+)?/i.exec(name);
  if (withheld) return `Withheld ${withheld[1] ?? ''}`.trim();
  const parts = name
    .replace(/\s*\(.*\)\s*$/, '')
    .trim()
    .split(/\s+/);
  if (parts.length < 2) return parts[0] ?? name;
  return `${parts[0]![0]}. ${parts.slice(1).join(' ')}`;
}
