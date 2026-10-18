import { describe, expect, it } from 'vitest';
import { difficulty, opponentCode, ordinal, runEase, sideRun } from '@/lib/fdr';
import {
  parseTable,
  parseTeamFeed,
  tableFeedUrl,
} from '../../supabase/functions/_shared/ehFixtures';

describe('difficulty', () => {
  it('rates home games 1 to 4 by quarter of the table', () => {
    expect(difficulty(1, 12, true)).toBe(4);
    expect(difficulty(3, 12, true)).toBe(4);
    expect(difficulty(4, 12, true)).toBe(3);
    expect(difficulty(7, 12, true)).toBe(2);
    expect(difficulty(10, 12, true)).toBe(1);
    expect(difficulty(12, 12, true)).toBe(1);
  });

  it('adds 1 away, so only a top side away is a 5', () => {
    expect(difficulty(1, 10, false)).toBe(5);
    expect(difficulty(9, 10, false)).toBe(2);
    expect(difficulty(10, 10, false)).toBe(2);
  });

  it('matches the board examples', () => {
    expect(difficulty(3, 10, true)).toBe(4);
    expect(difficulty(2, 12, true)).toBe(4);
  });

  it('gives nothing for a place outside the table', () => {
    expect(difficulty(0, 10, true)).toBeNull();
    expect(difficulty(11, 10, true)).toBeNull();
    expect(difficulty(1, 0, true)).toBeNull();
  });
});

describe('opponentCode', () => {
  it('makes three letters', () => {
    expect(opponentCode('Cambridge South 1')).toBe('CAS');
    expect(opponentCode('Cambridge 1')).toBe('CAM');
    expect(opponentCode('City Of Peterborough 2')).toBe('PET');
    expect(opponentCode('Ipswich-East Suffolk 2')).toBe('IES');
    expect(opponentCode('Harleston Magpies 2')).toBe('HAM');
    expect(opponentCode('Spalding 1')).toBe('SPA');
  });
});

describe('sideRun and runEase', () => {
  const fixtures = [
    { id: 1, side_id: 1, gameweek_id: 10, opponent: 'Cambridge South 1', is_home: true },
    { id: 2, side_id: 1, gameweek_id: 12, opponent: 'Ely 2', is_home: false },
    { id: 3, side_id: 1, gameweek_id: 13, opponent: 'Cup Opponents 1', is_home: true },
  ];
  const places = new Map([
    [1, { position: 3, teams: 10 }],
    [2, { position: 9, teams: 10 }],
  ]);

  it('fills each gameweek, with a dash for no game and no rating for a cup tie', () => {
    const run = sideRun(fixtures, 1, [10, 11, 12, 13], places);
    expect(run.map((c) => c.code)).toEqual(['CAS', null, 'ELY', 'CUO']);
    expect(run.map((c) => c.rating)).toEqual([4, null, 2, null]);
  });

  it('scores a run higher when it is easier', () => {
    const hard = sideRun(fixtures, 1, [10], places);
    const easy = sideRun(fixtures, 1, [12], places);
    expect(runEase(easy)!).toBeGreaterThan(runEase(hard)!);
    expect(runEase(sideRun(fixtures, 1, [11], places))).toBeNull();
  });
});

describe('ordinal', () => {
  it('spells places', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
    ]);
  });
});

describe('England Hockey league tables', () => {
  it('keeps the feed order as positions', () => {
    const rows = parseTable([
      { teamName: 'Cambridge South 1', gamesPlayed: 6, totalPoints: 15 },
      { teamName: ' Felixstowe 1 ', gamesPlayed: 6, totalPoints: 9 },
      { teamName: null },
    ]);
    expect(rows).toEqual([
      { team_name: 'Cambridge South 1', position: 1, played: 6, points: 15 },
      { team_name: 'Felixstowe 1', position: 2, played: 6, points: 9 },
    ]);
  });

  it('builds the table address from the team feed', () => {
    expect(
      tableFeedUrl('https://ehdwapi.englandhockey.co.uk/api/teams/abc/fixturesandresults', 'xyz'),
    ).toBe('https://ehdwapi.englandhockey.co.uk/api/competitions/xyz/table');
  });

  it('picks the league with the most fixtures', () => {
    const fx = (id: string) => ({
      id,
      fixtureDate: '2026-10-24T13:00:00',
      homeTeam: { entityUrlSlug: 'felixstowe-1-mens' },
      awayTeam: { teamName: 'Ely 1' },
    });
    const parsed = parseTeamFeed(
      [
        { competitionId: 'cup', competitionName: 'Cup', fixtures: [fx('a')] },
        { competitionId: 'league', competitionName: 'League', fixtures: [fx('b'), fx('c')] },
      ],
      'felixstowe-1-mens',
    );
    expect(parsed.competitionId).toBe('league');
  });
});
