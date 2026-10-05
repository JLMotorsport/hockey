// Pure parsing for the club's Pitchero site (felixstowehockeyclub.co.uk).
// Pages embed their data as Next.js JSON (__NEXT_DATA__); we read the team's
// fixture list and each match's line-up from it. No Deno or Node APIs, so the
// Edge Function and vitest share it.

export const PITCHERO_SITE = 'https://www.felixstowehockeyclub.co.uk';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});

export function nextData(html: string): Json {
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('Pitchero page has no data.');
  return obj(JSON.parse(m[1]!));
}

function reduxTeams(data: Json): Json {
  return obj(obj(obj(data.props).initialReduxState).teams);
}

export interface PitcheroFixture {
  id: string;
  /** UK date of the match, e.g. "2026-09-19". */
  date: string;
  /** Push-back with its UK offset, e.g. "2026-09-19T13:30:00+01:00". */
  dateTime: string;
  opponent: string;
  played: boolean;
}

export function parseFixtures(data: Json, teamId: number): PitcheroFixture[] {
  const all = obj(obj(obj(reduxTeams(data).fixtures).fixtures)[String(teamId)]);
  return Object.values(all)
    .map(obj)
    .filter((f) => typeof f.id === 'string' && typeof f.dateTime === 'string')
    .map((f) => ({
      id: f.id as string,
      date: (f.dateTime as string).slice(0, 10),
      dateTime: f.dateTime as string,
      opponent: typeof f.opponent === 'string' ? f.opponent : '',
      played: f.hasOutcome === true,
    }));
}

const words = (name: string) =>
  new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 || /^\d+$/.test(w)),
  );

/**
 * The Pitchero match for one of our fixtures: same UK date, not already used
 * for another fixture. With two on one day (7s, tournaments), the one whose
 * opponent shares most words with ours, then the nearest push-back.
 */
export function pickPitcheroMatch(
  candidates: PitcheroFixture[],
  fixture: { kickoff: string; opponent: string },
  ukDate: string,
  used: Set<string> = new Set(),
): PitcheroFixture | undefined {
  const sameDay = candidates.filter((f) => f.date === ukDate && !used.has(f.id));
  if (sameDay.length <= 1) return sameDay[0];
  const ours = words(fixture.opponent);
  const overlap = (f: PitcheroFixture) => [...words(f.opponent)].filter((w) => ours.has(w)).length;
  const gap = (f: PitcheroFixture) =>
    Math.abs(Date.parse(f.dateTime) - Date.parse(fixture.kickoff));
  return [...sameDay].sort((a, b) => overlap(b) - overlap(a) || gap(a) - gap(b))[0];
}

export interface PitcheroPlayer {
  pitchero_player_id: number;
  name: string;
  shirt: string | null;
  position: string | null;
  starter: boolean;
}

export interface PitcheroLineup {
  players: PitcheroPlayer[];
  /** Names in Pitchero's player-of-the-match field (often empty). */
  potm: string[];
}

export function parseLineup(data: Json, teamId: number, fixtureId: string): PitcheroLineup {
  const page = obj(obj(obj(reduxTeams(data).matchCentre).pageData)[`${teamId}-${fixtureId}`]);
  const lineup = obj(page.lineup);
  const list = (v: unknown) => (Array.isArray(v) ? v.map(obj) : []);
  const players = [...list(lineup.players), ...list(lineup.substitutes)]
    .filter((p) => typeof p.playerId === 'number' && typeof p.name === 'string')
    .map((p) => ({
      pitchero_player_id: p.playerId as number,
      name: (p.name as string).trim(),
      shirt: p.number === null || p.number === undefined ? null : String(p.number),
      position: typeof p.position === 'string' ? p.position : null,
      starter: p.appearance !== 'unused_substitute',
    }));
  const potm = list(obj(page.overview).playersOfTheMatch)
    .map((p) => (typeof p.name === 'string' ? p.name.trim() : ''))
    .filter(Boolean);
  return { players, potm };
}
