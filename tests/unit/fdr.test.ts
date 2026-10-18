import { describe, expect, it } from 'vitest';
import { difficulty, opponentCode, ordinal, placeLine, runEase, sideRun } from '@/lib/fdr';
import {
  parseTable,
  parseTeamFeed,
  tableFeedUrl,
} from '../../supabase/functions/_shared/ehFixtures';

describe('difficulty from the gap between the teams', () => {
  // 12 teams: "well" above or below is more than 4 places.
  it('rates home games by how far the opponent is above or below us', () => {
    expect(difficulty(1, 12, true, 8)).toBe(4); // 7 places above
    expect(difficulty(3, 12, true, 8)).toBe(4); // 5 above
    expect(difficulty(4, 12, true, 8)).toBe(3); // 4 above
    expect(difficulty(5, 12, true, 8)).toBe(3); // 3 above
    expect(difficulty(7, 12, true, 8)).toBe(3); // 1 above
    expect(difficulty(9, 12, true, 8)).toBe(2); // 1 below
    expect(difficulty(11, 12, true, 8)).toBe(2); // 3 below
    expect(difficulty(12, 12, true, 8)).toBe(2); // 4 below
    expect(difficulty(12, 12, true, 4)).toBe(1); // 8 below
  });

  it('adds 1 away, so an even game away is a 3 and only a much stronger side a 5', () => {
    expect(difficulty(6, 12, false, 5)).toBe(3);
    expect(difficulty(1, 12, false, 12)).toBe(5);
    expect(difficulty(12, 12, false, 1)).toBe(2);
  });

  it('rates a team just below a top side as below us, not the easiest', () => {
    // W2 2nd v Sudbury 3 Development 5th of 11.
    expect(difficulty(5, 11, true, 2)).toBe(2);
    expect(difficulty(6, 11, true, 2)).toBe(1);
  });

  it('makes a bottom side mostly hard and a top side mostly easy', () => {
    const bottom = [1, 3, 6, 9, 11].map((p) => difficulty(p, 12, true, 12));
    const top = [2, 4, 6, 9, 12].map((p) => difficulty(p, 12, true, 1));
    expect(bottom).toEqual([4, 4, 4, 3, 3]);
    expect(top).toEqual([2, 2, 1, 1, 1]);
  });
});

describe('difficulty without our place', () => {
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
    [1, { position: 3, teams: 10, ours: null }],
    [2, { position: 9, teams: 10, ours: null }],
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

describe('placeLine', () => {
  it('says where both teams are', () => {
    expect(placeLine(true, { position: 3, teams: 12, ours: 8 })).toBe(
      "Home · 3rd, we're 8th of 12",
    );
    expect(placeLine(false, { position: 9, teams: 10, ours: null })).toBe('Away (+1) · 9th of 10');
    expect(placeLine(true, undefined)).toBe('Home');
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
    const rows = parseTable(
      [
        { teamName: 'Cambridge South 1', gamesPlayed: 6, totalPoints: 15 },
        {
          teamName: ' Felixstowe 1 ',
          teamEntityUrlSlug: 'felixstowe-1-mens',
          gamesPlayed: 6,
          totalPoints: 9,
        },
        { teamName: null },
      ],
      'felixstowe-1-mens',
    );
    expect(rows).toEqual([
      { team_name: 'Cambridge South 1', is_us: false, position: 1, played: 6, points: 15 },
      { team_name: 'Felixstowe 1', is_us: true, position: 2, played: 6, points: 9 },
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
