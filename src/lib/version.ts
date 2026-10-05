// The build the app is running, e.g. "5101740" for 5 Oct 17:40, for testers to quote.

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: 'numeric',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Day, month, hour, minute in UK time as one number: 5 Oct 17:40 is
 * "5101740". The month always has two digits so dates never run together.
 */
export function buildLabel(iso: string): string {
  const p = Object.fromEntries(parts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.day}${p.month}${p.hour}${p.minute}`;
}

export const BUILD_LABEL = buildLabel(__BUILD_TIME__);
export const BUILD_COMMIT = __BUILD_COMMIT__;
