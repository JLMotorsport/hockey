// The build the app is running, e.g. "5 Oct 17:40", for testers to quote.

const stamp = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** "5 Oct 17:40" in UK time. */
export function buildLabel(iso: string): string {
  return stamp.format(new Date(iso)).replace(',', '');
}

export const BUILD_LABEL = buildLabel(__BUILD_TIME__);
export const BUILD_COMMIT = __BUILD_COMMIT__;
