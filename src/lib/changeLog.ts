// The super user's change log (migration 0021): raw manager_log rows turned
// into actions people can read ("Amy Fenn changed H. Garrod's price"), what
// an undo would put back, and whether a later change is in the way.
// Pure, so it can be unit tested.

export type Json = { [key: string]: unknown };

export interface LogRow {
  id: number;
  at: string;
  tx: number;
  actor: string | null;
  table_name: string;
  op: string;
  row_id: string;
  old_data: Json | null;
  new_data: Json | null;
  undone_at: string | null;
  undone_by: string | null;
}

/** One manager action: everything one save wrote (one database transaction). */
export interface Action {
  tx: number;
  /** Its first log row's id: what undo_change() is given. */
  id: number;
  at: string;
  actor: string | null;
  rows: LogRow[];
  undoneAt: string | null;
  undoneBy: string | null;
}

export type Filter = 'all' | 'matches' | 'players' | 'gameweeks' | 'managers';

export const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['matches', 'Matches'],
  ['players', 'Players'],
  ['gameweeks', 'Gameweeks'],
  ['managers', 'Managers'],
];

/** Names for the ids in log rows. Anything missing reads as a plain fallback. */
export interface Names {
  player: (id: number) => string | undefined;
  side: (id: number) => string | undefined;
  /** A fixture still in the database (performances only carry its id). */
  fixture: (id: number) => Json | undefined;
  gameweek: (id: number) => number | undefined;
  person: (id: string) => string | undefined;
}

/** Newest first, one entry per transaction. */
export function groupActions(rows: LogRow[]): Action[] {
  const byTx = new Map<number, LogRow[]>();
  for (const r of rows) {
    const list = byTx.get(r.tx) ?? [];
    list.push(r);
    byTx.set(r.tx, list);
  }
  return [...byTx.entries()]
    .map(([tx, list]) => {
      const sorted = [...list].sort((a, b) => a.id - b.id);
      const first = sorted[0]!;
      return {
        tx,
        id: first.id,
        at: first.at,
        actor: first.actor,
        rows: sorted,
        undoneAt: sorted.find((r) => r.undone_at)?.undone_at ?? null,
        undoneBy: sorted.find((r) => r.undone_by)?.undone_by ?? null,
      };
    })
    .sort((a, b) => b.id - a.id);
}

const KIND: Record<string, Filter> = {
  fixtures: 'matches',
  performances: 'matches',
  players: 'players',
  gameweeks: 'gameweeks',
  league_settings: 'gameweeks',
  sides: 'gameweeks',
  profiles: 'managers',
  accounts: 'managers',
};

export function matchesFilter(action: Action, filter: Filter): boolean {
  return filter === 'all' || action.rows.some((r) => KIND[r.table_name] === filter);
}

/** Account removals can't be undone (the login itself is gone). */
export function canUndo(action: Action): boolean {
  return !action.undoneAt && !action.rows.some((r) => r.table_name === 'accounts');
}

/**
 * The later action, not undone, that changed something this one touched:
 * undo_change() refuses until that one is undone first.
 */
export function blockedBy(action: Action, all: Action[]): Action | null {
  if (action.undoneAt) return null;
  const touched = new Set(action.rows.map((r) => `${r.table_name}:${r.row_id}`));
  const later = all
    .filter((a) => a.id > action.id && !a.undoneAt && a.tx !== action.tx)
    .filter((a) => a.rows.some((r) => touched.has(`${r.table_name}:${r.row_id}`)))
    .sort((a, b) => a.id - b.id);
  return later[0] ?? null;
}

// --- Words -------------------------------------------------------------------

const POSITION_WORD: Record<string, string> = {
  GK: 'goalkeeper',
  DEF: 'defender',
  MID: 'midfielder',
  FWD: 'forward',
};

const ukTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
/** A JSON value as text (anything that isn't a plain value: the fallback). */
const text = (v: unknown, fallback = ''): string =>
  typeof v === 'string'
    ? v
    : typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : fallback;
const when = (iso: unknown) => (typeof iso === 'string' ? ukTime.format(new Date(iso)) : '');
const price = (tenths: unknown) =>
  typeof tenths === 'number' ? `${(tenths / 10).toFixed(1)}m` : '-';
const score = (row: Json | null | undefined) =>
  row && row.goals_for !== null && row.goals_for !== undefined && row.goals_against !== null
    ? `${text(row.goals_for)}-${text(row.goals_against)}`
    : 'No score';

function changed(r: LogRow): string[] {
  if (!r.old_data || !r.new_data) return [];
  return Object.keys(r.new_data).filter(
    (k) => JSON.stringify(r.old_data![k]) !== JSON.stringify(r.new_data![k]),
  );
}

function fixtureName(row: Json | null | undefined, names: Names): string {
  if (!row) return 'a match';
  const side = names.side(Number(row.side_id)) ?? 'Felixstowe';
  return `${side} v ${text(row.opponent, 'opponent')}`;
}

function playerName(r: LogRow, names: Names): string {
  const row = r.new_data ?? r.old_data ?? {};
  return text(row.name) || names.player(Number(r.row_id)) || 'a player';
}

/** The players a set of performance rows name (goals, POTM, how many). */
function statsSummary(perfs: (Json | null)[], names: Names) {
  const rows = perfs.filter((p): p is Json => Boolean(p));
  const who = (p: Json) => names.player(Number(p.player_id)) ?? 'a player';
  const goals = rows
    .filter((p) => Number(p.goals) > 0)
    .map((p) => {
      const n = Number(p.goals);
      return n > 1 ? `${who(p)} (${n})` : who(p);
    });
  const potm = rows.filter((p) => p.player_of_match === true).map(who);
  return {
    players: rows.length,
    goals: goals.length ? goals.join(', ') : 'None',
    potm: potm.length ? potm.join(', ') : 'None',
  };
}

export interface Described {
  /** After the actor's name: "changed H. Garrod's price". */
  what: string;
  /** The line under it. */
  detail: string;
}

/**
 * What a deleted player or fixture took with it (its price history, its
 * Pitchero line-up), kept so undo can put it back (0024). Not shown.
 */
const KEPT_WITH_PARENT = new Set(['pitchero_lineups', 'price_changes']);
const shown = (action: Action) => action.rows.filter((r) => !KEPT_WITH_PARENT.has(r.table_name));

export function describe(action: Action, names: Names): Described {
  const rows = shown(action);
  const perfs = rows.filter((r) => r.table_name === 'performances');
  const fixtureRow = rows.find((r) => r.table_name === 'fixtures');

  // A fixture deleted, with its stats along with it.
  if (fixtureRow?.op === 'delete') {
    const one = describeOne(fixtureRow, names);
    return perfs.length
      ? { ...one, detail: `${one.detail} · stats for ${plural(perfs.length, 'player')}` }
      : one;
  }

  // Stats edited, no one added or taken off and no score change.
  if (perfs.length && !fixtureRow && perfs.every((r) => r.op === 'update')) {
    const fixture = names.fixture(Number(perfs[0]!.new_data?.fixture_id));
    return {
      what: `updated stats for ${fixtureName(fixture, names)}`,
      detail: plural(perfs.length, 'player'),
    };
  }

  // A match saved: its stats (and maybe its score) in one go.
  if (perfs.length) {
    const fixture =
      fixtureRow?.new_data ??
      fixtureRow?.old_data ??
      names.fixture(Number((perfs[0]!.new_data ?? perfs[0]!.old_data)?.fixture_id));
    const after = statsSummary(
      perfs.map((r) => r.new_data),
      names,
    );
    const parts = [
      ...(fixtureRow ? [`Score ${score(fixtureRow.new_data)}`] : []),
      `${after.players} ${after.players === 1 ? 'player' : 'players'}`,
      ...(after.goals !== 'None' ? [`goals: ${after.goals}`] : []),
      ...(after.potm !== 'None' ? [`POTM: ${after.potm}`] : []),
    ];
    return { what: `saved ${fixtureName(fixture, names)}`, detail: parts.join(' · ') };
  }

  if (rows.length === 1) return describeOne(rows[0]!, names);

  const tables = [...new Set(rows.map((r) => r.table_name.replace(/_/g, ' ')))];
  return { what: `made ${rows.length} changes`, detail: `To ${tables.join(', ')}` };
}

function describeOne(r: LogRow, names: Names): Described {
  const keys = changed(r);
  const o = r.old_data ?? {};
  const n = r.new_data ?? {};
  switch (r.table_name) {
    case 'players': {
      const name = playerName(r, names);
      if (r.op === 'insert') return { what: `added ${name}`, detail: playerLine(n, names) };
      if (r.op === 'delete') return { what: `deleted ${name}`, detail: playerLine(o, names) };
      if (keys.length === 1 && keys[0] === 'price')
        return { what: `changed ${name}'s price`, detail: `${price(o.price)} → ${price(n.price)}` };
      if (keys.includes('position'))
        return {
          what: `made ${name} a ${POSITION_WORD[String(n.position)] ?? String(n.position)}`,
          detail: `Was a ${POSITION_WORD[String(o.position)] ?? String(o.position)}`,
        };
      if (keys.length === 1 && keys[0] === 'active')
        return {
          what: n.active ? `made ${name} available` : `made ${name} unavailable`,
          detail: n.active ? 'Can be picked again' : 'Can no longer be picked',
        };
      if (keys.includes('name'))
        return { what: `renamed ${String(o.name)}`, detail: `Now ${String(n.name)}` };
      return { what: `edited ${name}`, detail: fieldList(keys) };
    }
    case 'fixtures': {
      const name = fixtureName(r.op === 'delete' ? o : n, names);
      const line = `${name}, ${when((r.op === 'delete' ? o : n).kickoff)}`;
      if (r.op === 'insert') return { what: 'added a fixture', detail: line };
      if (r.op === 'delete') return { what: 'deleted a fixture', detail: line };
      if (keys.some((k) => k === 'goals_for' || k === 'goals_against'))
        return { what: `set the score for ${name}`, detail: `${score(o)} → ${score(n)}` };
      if (keys.includes('kickoff'))
        return { what: `moved ${name}`, detail: `${when(o.kickoff)} → ${when(n.kickoff)}` };
      if (keys.includes('stats_locked'))
        return { what: `${n.stats_locked ? 'locked' : 'unlocked'} ${name}`, detail: 'Match stats' };
      if (keys.includes('stats_complete'))
        return {
          what: `marked ${name} ${n.stats_complete ? 'complete' : 'not complete'}`,
          detail: 'Match stats',
        };
      return { what: `edited ${name}`, detail: fieldList(keys) };
    }
    case 'gameweeks': {
      const gw = `GW${names.gameweek(Number(r.row_id)) ?? '?'}`;
      if (r.op === 'insert') return { what: `added ${gw}`, detail: `Deadline ${when(n.deadline)}` };
      if (r.op === 'delete')
        return { what: `deleted ${gw}`, detail: `Deadline ${when(o.deadline)}` };
      if (keys.includes('deadline'))
        return {
          what: `changed the ${gw} deadline`,
          detail: `${when(o.deadline)} → ${when(n.deadline)}`,
        };
      return { what: `edited ${gw}`, detail: fieldList(keys) };
    }
    case 'league_settings':
      return {
        what: 'changed the league settings',
        detail: keys
          .map((k) => `${k.replace(/_/g, ' ')}: ${show(o[k])} → ${show(n[k])}`)
          .join(' · '),
      };
    case 'sides':
      return {
        what: `edited the ${text(n.name) || text(o.name, 'side')}`,
        detail: fieldList(keys),
      };
    case 'profiles': {
      const name = text(n.display_name) || names.person(r.row_id) || 'someone';
      return n.is_admin
        ? { what: `made ${name} a manager`, detail: 'Can open the managers area' }
        : { what: `removed ${name} as a manager`, detail: 'Can no longer open the managers area' };
    }
    case 'accounts':
      return {
        what: `removed ${text(o.display_name, 'someone')}'s account`,
        detail: `Team: ${text(o.team_name)}`,
      };
    default:
      return { what: `changed ${r.table_name.replace(/_/g, ' ')}`, detail: fieldList(keys) };
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function playerLine(row: Json, names: Names): string {
  const side = names.side(Number(row.side_id));
  return [POSITION_WORD[String(row.position)], side, price(row.price)].filter(Boolean).join(' · ');
}

function show(v: unknown): string {
  if (v === null || v === undefined) return 'none';
  if (Array.isArray(v)) return v.map((x) => text(x)).join(', ');
  return text(v, JSON.stringify(v));
}

function fieldList(keys: string[]): string {
  return keys.length ? `Changed: ${keys.map((k) => k.replace(/_/g, ' ')).join(', ')}` : '';
}

// --- What an undo puts back ----------------------------------------------------

/** For the confirm sheet: each line, as it is now and as undo would make it. */
export interface UndoLine {
  label: string;
  now: string;
  back: string;
}

export function undoLines(action: Action, names: Names): UndoLine[] {
  // Only what would actually change back.
  return allUndoLines(action, names).filter((l) => l.now !== l.back);
}

function allUndoLines(action: Action, names: Names): UndoLine[] {
  const rows = shown(action);
  const perfs = rows.filter((r) => r.table_name === 'performances');
  const fixtureRow = rows.find((r) => r.table_name === 'fixtures');
  if (fixtureRow?.op === 'delete') {
    return [{ label: describeOne(fixtureRow, names).detail, now: 'Deleted', back: 'Put back' }];
  }
  if (perfs.length) {
    const now = statsSummary(
      perfs.map((r) => r.new_data),
      names,
    );
    const back = statsSummary(
      perfs.map((r) => r.old_data),
      names,
    );
    return [
      ...(fixtureRow
        ? [{ label: 'Score', now: score(fixtureRow.new_data), back: score(fixtureRow.old_data) }]
        : []),
      {
        label: 'Players',
        now: String(now.players || 'None'),
        back: String(back.players || 'None'),
      },
      { label: 'Goals', now: now.goals, back: back.goals },
      { label: 'POTM', now: now.potm, back: back.potm },
    ];
  }
  return rows.flatMap((r): UndoLine[] => {
    const what = describeOne(r, names);
    if (r.op === 'insert') return [{ label: what.what, now: 'Added', back: 'Removed' }];
    if (r.op === 'delete') return [{ label: what.what, now: 'Deleted', back: 'Put back' }];
    return changed(r).map((k) => ({
      label: k.replace(/_/g, ' '),
      now: lineValue(k, r.new_data?.[k]),
      back: lineValue(k, r.old_data?.[k]),
    }));
  });
}

function lineValue(key: string, v: unknown): string {
  if (key === 'price') return price(v);
  if (key === 'kickoff' || key === 'deadline') return when(v);
  if (key === 'position') return POSITION_WORD[String(v)] ?? show(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return show(v);
}

/** "Today", "Yesterday" or "Thu 15 Oct", UK time. */
export function dayHeading(iso: string, now = new Date()): string {
  const day = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d);
  const d = day(new Date(iso));
  if (d === day(now)) return 'Today';
  if (d === day(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

/** "14:31", UK time. */
export function clock(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
