// Pitchero's availability export (one CSV per day) turned into flags (0043).
// Rule, per person, from the matches they were asked about that day:
//   picked for any side            -> no flag (they're playing)
//   yes to one, no or not sure to another, not picked -> Doubtful
//   yes                            -> no flag
//   no to everything they answered -> Out
//   not sure                       -> Doubtful
// "Not set" and "Not asked" are no answer. Byes aren't matches. Pure, so it
// can be unit tested.

export type AvailabilityFlag = 'out' | 'doubtful';

export interface AvailabilityRow {
  name: string;
  flag: AvailabilityFlag | null;
  /** For the manager's check screen only; players never see it. */
  why: string;
  /** Picked for one side after saying no or not sure to another (shown, not flagged). */
  pickedDespiteNo?: boolean;
}

/** A CSV file as rows of cells: quoted cells, doubled quotes, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** The day an export is for, from Pitchero's file name ("availability-...-2026-11-21.csv"). */
export function exportDate(fileName: string): string | null {
  return /(\d{4}-\d{2}-\d{2})\.csv$/i.exec(fileName)?.[1] ?? null;
}

const NO_ANSWER = new Set(['', 'not set', 'not asked']);
/** A selection cell that means picked (Pitchero shows "Unconfirmed" until they confirm). */
const isPicked = (v: string) => v.trim() !== '' && !/declin|unavailable|reject/i.test(v);

/** Everyone in an availability export, with the flag the rule gives them. */
export function readAvailability(text: string): AvailabilityRow[] {
  const [head, ...body] = parseCsv(text);
  if (!head) return [];
  const col = (name: string) => head.findIndex((h) => h.trim().toLowerCase() === name);
  const first = col('first name');
  const last = col('last name');
  const day = col('day availability');
  if (first < 0 || last < 0) throw new Error('This isn’t a Pitchero availability export.');
  const matches: { i: number; name: string }[] = [];
  const picks: number[] = [];
  head.forEach((h, i) => {
    if (i <= Math.max(day, col('teams'), col('position'))) return;
    if (/^note$/i.test(h.trim())) return;
    if (/ selection$/i.test(h)) picks.push(i);
    else if (!/\bv bye\b|\bbye v\b/i.test(h))
      matches.push({ i, name: h.replace(/^\d{1,2}:\d{2}\s*/, '') });
  });

  return body.map((r) => {
    const name = `${(r[first] ?? '').trim()} ${(r[last] ?? '').trim()}`.trim();
    const answered = matches
      .map((m) => ({ match: m.name, answer: (r[m.i] ?? '').trim() }))
      .filter((a) => !NO_ANSWER.has(a.answer.toLowerCase()));
    const dayAnswer = day >= 0 ? (r[day] ?? '').trim().toLowerCase() : '';
    const yes = answered.filter((a) => /^available$/i.test(a.answer));
    const no = answered.filter((a) => /^unavailable$/i.test(a.answer));
    const maybe = answered.filter((a) => /^not sure$/i.test(a.answer));
    const pickedFor = picks.find((i) => isPicked(r[i] ?? ''));
    if (pickedFor !== undefined) {
      const side = head[pickedFor]!.replace(/^\d{1,2}:\d{2}\s*/, '').replace(/ selection$/i, '');
      return {
        name,
        flag: null,
        why: `Picked for ${side}`,
        pickedDespiteNo: no.length + maybe.length > 0 || dayAnswer === 'unavailable',
      };
    }
    const doubts = [...no, ...maybe];
    if (yes.length && (doubts.length || dayAnswer === 'unavailable'))
      return {
        name,
        flag: 'doubtful',
        why: `No or not sure for ${doubts.map((a) => a.match).join(', ') || 'the day'}, yes for ${yes.map((a) => a.match).join(', ')}, not picked yet`,
      };
    if (yes.length) return { name, flag: null, why: 'Available' };
    if (maybe.length || (dayAnswer === 'not sure' && !no.length))
      return {
        name,
        flag: 'doubtful',
        why: `Not sure${maybe.length ? `: ${maybe.map((a) => a.match).join(', ')}` : ' for the day'}`,
      };
    if (no.length || dayAnswer === 'unavailable')
      return {
        name,
        flag: 'out',
        why: no.length
          ? `Unavailable: ${no.map((a) => a.match).join(', ')}`
          : 'Unavailable all day',
      };
    return { name, flag: null, why: 'No answer' };
  });
}
