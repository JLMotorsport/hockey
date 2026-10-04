// Pure parsing for England Hockey's public team feed. No Deno or Node APIs so
// the Edge Function and the vitest suite share it.
//
// Felixstowe's team pages on englandhockey.co.uk (e.g. /teams/felixstowe-1-mens)
// load fixtures from a JSON API. The page embeds the API address and a public
// key in data attributes, so we read them from the page on every sync rather
// than hard-coding them.
//
// The team feed has fixtures and scores. Each played fixture also has its own
// feed (the data behind the match page) with line-ups, goal scorers and cards.
// Assists, player of the match and outfield positions are not published.

export const EH_TEAM_PAGE = 'https://www.englandhockey.co.uk/teams/';

export interface FeedLocation {
  url: string;
  key: string;
}

export interface FixtureRow {
  eh_fixture_id: string;
  /** UK wall-clock time, no offset, e.g. "2026-09-12T13:30:00". */
  kickoff: string;
  opponent: string;
  is_home: boolean;
  goals_for: number | null;
  goals_against: number | null;
  /** England Hockey's id for the Felixstowe team in this fixture. */
  eh_team_id: string | null;
}

export interface ParsedTeam {
  competition: string | null;
  rows: FixtureRow[];
}

export class EhFeedError extends Error {}

export function findFeed(html: string): FeedLocation {
  const url = /data-url="([^"]+fixturesandresults[^"]*)"/.exec(html)?.[1];
  const key = /data-url-key="([^"]+)"/.exec(html)?.[1];
  if (!url || !key) throw new EhFeedError('Could not find the fixtures feed on the team page.');
  return { url: url.replace(/&amp;/g, '&'), key };
}

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === 'object' ? (value as Json) : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function score(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : str(value);
  if (text === null || !/^\d+$/.test(text.trim())) return null;
  return Number(text);
}

/** Turn the feed for one Felixstowe side into fixture rows from that side's point of view. */
export function parseTeamFeed(payload: unknown, slug: string): ParsedTeam {
  if (!Array.isArray(payload)) throw new EhFeedError('Unexpected feed format.');
  let competition: string | null = null;
  const rows: FixtureRow[] = [];

  for (const comp of payload.map(obj)) {
    competition = str(comp.competitionName) ?? competition;
    const fixtures = Array.isArray(comp.fixtures) ? comp.fixtures.map(obj) : [];
    for (const fx of fixtures) {
      if (fx.isBye === true) continue;
      const id = str(fx.id);
      const kickoff = str(fx.fixtureDate);
      const home = obj(fx.homeTeam);
      const away = obj(fx.awayTeam);
      if (!id || !kickoff) continue;

      const isHome = home.entityUrlSlug === slug;
      const opponent = str((isHome ? away : home).teamName) ?? 'Unknown';
      let goalsFor: number | null = null;
      let goalsAgainst: number | null = null;
      if (fx.isResult === true) {
        const h = score(fx.homeTeamScore);
        const a = score(fx.awayTeamScore);
        if (h !== null && a !== null) {
          [goalsFor, goalsAgainst] = isHome ? [h, a] : [a, h];
        }
      }
      rows.push({
        eh_fixture_id: id,
        kickoff: kickoff.slice(0, 19),
        opponent,
        is_home: isHome,
        goals_for: goalsFor,
        goals_against: goalsAgainst,
        eh_team_id: str(isHome ? fx.homeTeamId : fx.awayTeamId) ?? str((isHome ? home : away).id),
      });
    }
  }
  return { competition, rows };
}

/** The per-fixture feed lives next to the team feed: .../api/fixtures/<id>. */
export function fixtureFeedUrl(teamFeedUrl: string, fixtureId: string): string {
  return `${new URL(teamFeedUrl).origin}/api/fixtures/${encodeURIComponent(fixtureId)}`;
}

export interface LineupPlayer {
  member_id: string;
  name: string;
  is_gk: boolean;
  goals: number;
  green_cards: number;
  yellow_cards: number;
  red_cards: number;
}

export interface ParsedLineup {
  players: LineupPlayer[];
  /** Players who have withheld their name: they can't be matched or scored. */
  withheld: number;
  /** Event codes we don't score, so a new code shows up in the sync report. */
  unknownEvents: string[];
}

// FG field goal, PC penalty corner, PS penalty stroke.
const GOAL_EVENTS = new Set(['FG', 'PC', 'PS']);
const CARD_EVENTS: Record<string, 'green_cards' | 'yellow_cards' | 'red_cards'> = {
  GC: 'green_cards',
  YC: 'yellow_cards',
  RC: 'red_cards',
};

/** Felixstowe's players in one fixture, with their goals and cards. */
export function parseLineup(payload: unknown, teamId: string): ParsedLineup {
  const fx = obj(payload);
  const roster = Array.isArray(fx.allPlayers)
    ? fx.allPlayers
    : [
        ...(Array.isArray(fx.homePlayers) ? fx.homePlayers : []),
        ...(Array.isArray(fx.awayPlayers) ? fx.awayPlayers : []),
      ];

  const players = new Map<string, LineupPlayer>();
  let withheld = 0;
  for (const p of roster.map(obj)) {
    if (p.teamId !== teamId) continue;
    const memberId = str(p.memberId);
    const name = str(p.displayName);
    if (!memberId || !name || p.consent === false || /^name withheld$/i.test(name)) {
      withheld += 1;
      continue;
    }
    players.set(memberId, {
      member_id: memberId,
      name: name.trim(),
      is_gk: /\bGK\b/i.test(String(p.otherRoleDescription ?? '')),
      goals: 0,
      green_cards: 0,
      yellow_cards: 0,
      red_cards: 0,
    });
  }

  const unknown = new Set<string>();
  const events = Array.isArray(fx.fixtureEvents) ? fx.fixtureEvents.map(obj) : [];
  for (const e of events) {
    if (e.teamId !== teamId) continue;
    const code = str(e.eventType)?.toUpperCase();
    const player = players.get(str(e.memberId) ?? '');
    if (!code) continue;
    if (GOAL_EVENTS.has(code)) {
      if (player) player.goals += 1;
    } else if (code in CARD_EVENTS) {
      if (player) player[CARD_EVENTS[code]!] += 1;
    } else {
      unknown.add(code);
    }
  }
  return { players: [...players.values()], withheld, unknownEvents: [...unknown] };
}
