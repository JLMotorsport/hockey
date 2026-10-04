// Pure parsing for England Hockey's public team feed. No Deno or Node APIs so
// the Edge Function and the vitest suite share it.
//
// Felixstowe's team pages on englandhockey.co.uk (e.g. /teams/felixstowe-1-mens)
// load fixtures from a JSON API. The page embeds the API address and a public
// key in data attributes, so we read them from the page on every sync rather
// than hard-coding them. The feed has fixtures and scores only: scorers, cards
// and line-ups are not published for these leagues.

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
      });
    }
  }
  return { competition, rows };
}
