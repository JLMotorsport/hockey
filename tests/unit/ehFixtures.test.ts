import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EhFeedError,
  findFeed,
  parseTeamFeed,
} from '../../supabase/functions/_shared/ehFixtures.ts';

const feed: unknown = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/eh-felixstowe-1-mens.json'), 'utf8'),
);

describe('findFeed', () => {
  it('reads the API address and key from the team page', () => {
    const html =
      '<div data-module="competitions-team-fixtures" data-url-key="abc123" data-url="https://ehdwapi.englandhockey.co.uk/api/teams/7588/fixturesandresults"></div>';
    expect(findFeed(html)).toEqual({
      url: 'https://ehdwapi.englandhockey.co.uk/api/teams/7588/fixturesandresults',
      key: 'abc123',
    });
  });

  it('fails clearly when the page changes', () => {
    expect(() => findFeed('<html></html>')).toThrow(EhFeedError);
  });
});

describe('parseTeamFeed (real Felixstowe 1 feed)', () => {
  const { competition, rows } = parseTeamFeed(feed, 'felixstowe-1-mens');

  it('reads the competition and every fixture', () => {
    expect(competition).toBe("East Open - Men's Division 1 North");
    expect(rows).toHaveLength(6);
  });

  it('keeps home scores as they are', () => {
    expect(rows.find((r) => r.opponent === 'City Of Peterborough 2')).toMatchObject({
      is_home: true,
      goals_for: 1,
      goals_against: 4,
      kickoff: '2026-09-12T13:30:00',
    });
  });

  it('flips away scores so goals_for is always Felixstowe', () => {
    expect(rows.find((r) => r.opponent === 'Spalding 1')).toMatchObject({
      is_home: false,
      goals_for: 0,
      goals_against: 6,
    });
  });

  it('leaves unplayed fixtures without a score', () => {
    expect(rows.find((r) => r.opponent === 'Kettering 1')).toMatchObject({
      goals_for: null,
      goals_against: null,
    });
  });
});

describe('parseTeamFeed edge cases', () => {
  const fx = (over: Record<string, unknown>) => ({
    id: 'x',
    fixtureDate: '2026-10-10T12:00:00',
    isResult: true,
    homeTeamScore: '2',
    awayTeamScore: '1',
    homeTeam: { teamName: 'Felixstowe 2', entityUrlSlug: 'felixstowe-2-womens' },
    awayTeam: { teamName: 'Felixstowe 3', entityUrlSlug: 'felixstowe-3-development-womens' },
    ...over,
  });

  it('gives each Felixstowe side its own view of a derby', () => {
    const payload = [{ competitionName: 'Div 4', fixtures: [fx({})] }];
    expect(parseTeamFeed(payload, 'felixstowe-2-womens').rows[0]).toMatchObject({
      goals_for: 2,
      goals_against: 1,
      opponent: 'Felixstowe 3',
    });
    expect(parseTeamFeed(payload, 'felixstowe-3-development-womens').rows[0]).toMatchObject({
      goals_for: 1,
      goals_against: 2,
      opponent: 'Felixstowe 2',
    });
  });

  it('skips byes and ignores junk scores', () => {
    const payload = [
      {
        competitionName: 'Div 4',
        fixtures: [fx({ isBye: true }), fx({ id: 'y', homeTeamScore: 'P' })],
      },
    ];
    const { rows } = parseTeamFeed(payload, 'felixstowe-2-womens');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ goals_for: null });
  });

  it('rejects a non-list payload', () => {
    expect(() => parseTeamFeed({ nope: true }, 'x')).toThrow(EhFeedError);
  });
});
