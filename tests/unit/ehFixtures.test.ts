import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EhFeedError,
  findFeed,
  fixtureFeedUrl,
  parseLineup,
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

describe('parseLineup (real Colchester 2 v Felixstowe 2 match, names anonymised)', () => {
  const match = JSON.parse(
    readFileSync(join(__dirname, '../fixtures/eh-fixture-colchester2-felixstowe2.json'), 'utf8'),
  );
  const felixstowe = match.awayTeamId as string;
  const lineup = parseLineup(match, felixstowe);

  it('takes only Felixstowe players, keeping withheld names by member id', () => {
    expect(lineup.players).toHaveLength(14);
    expect(lineup.withheld).toBe(1);
    expect(lineup.unmatched).toBe(0);
    const hidden = lineup.players.find((p) => p.withheld)!;
    expect(hidden).toMatchObject({ name: null, shirt: '5' });
    expect(hidden.member_id).toBeTruthy();
  });

  it('credits goals and cards to withheld players by member id', () => {
    const hidden = lineup.players.find((p) => p.withheld)!;
    const odd = {
      ...match,
      fixtureEvents: [
        {
          eventType: 'FG',
          teamId: felixstowe,
          memberId: hidden.member_id,
          displayName: 'Name Withheld',
        },
        {
          eventType: 'GC',
          teamId: felixstowe,
          memberId: hidden.member_id,
          displayName: 'Name Withheld',
        },
      ],
    };
    expect(parseLineup(odd, felixstowe).players.find((p) => p.withheld)).toMatchObject({
      goals: 1,
      green_cards: 1,
    });
  });

  it('marks the goalkeeper', () => {
    expect(lineup.players.filter((p) => p.is_gk)).toHaveLength(1);
  });

  it('credits Felixstowe goals and cards, not the opposition', () => {
    const scorers = lineup.players.filter((p) => p.goals > 0);
    expect(scorers).toHaveLength(1);
    expect(scorers[0]).toMatchObject({ goals: 1, yellow_cards: 1 });
    expect(lineup.players.reduce((n, p) => n + p.goals, 0)).toBe(1);
    expect(lineup.unknownEvents).toEqual([]);
  });

  it('reads the Felixstowe team id from the team feed', () => {
    const { rows } = parseTeamFeed(feed, 'felixstowe-1-mens');
    expect(rows[0]!.eh_team_id).toBe('7588ecc9-4bc5-4348-93f3-d3a933af0b7c');
    expect(
      fixtureFeedUrl('https://ehdwapi.englandhockey.co.uk/api/teams/x/fixturesandresults', 'abc'),
    ).toBe('https://ehdwapi.englandhockey.co.uk/api/fixtures/abc');
  });

  it('reports event codes it does not score', () => {
    const odd = {
      ...match,
      fixtureEvents: [{ eventType: 'ZZ', teamId: felixstowe, memberId: 'x' }],
    };
    expect(parseLineup(odd, felixstowe).unknownEvents).toEqual(['ZZ']);
  });
});
