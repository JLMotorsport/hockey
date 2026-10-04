import { fixtureLabel, formByPlayer, shortOpponent, sideForm } from '@/lib/form';

describe('fixtures for picking', () => {
  it('shortens opponent names', () => {
    expect(shortOpponent('Spalding 1')).toBe('Spalding 1');
    expect(shortOpponent('City Of Peterborough 2')).toBe('Peterborough 2');
    expect(shortOpponent('Ipswich & East Suffolk 2')).toBe('Ipswich 2');
    expect(shortOpponent('Bury St Edmunds Hockey Club 3')).toBe('Bury 3');
  });

  it('says who a side plays, or that it has no game', () => {
    const fixtures = [
      { side_id: 1, gameweek_id: 5, opponent: 'Spalding 1', is_home: true },
      { side_id: 2, gameweek_id: 5, opponent: 'Kettering 1', is_home: false },
      { side_id: 2, gameweek_id: 5, opponent: 'Ely 2', is_home: true },
    ];
    expect(fixtureLabel(fixtures, 1, 5)).toBe('Spalding 1 (H)');
    expect(fixtureLabel(fixtures, 2, 5)).toBe('2 games');
    expect(fixtureLabel(fixtures, 3, 5)).toBe('No game');
  });
});

describe('form', () => {
  it('averages the last 3 gameweeks played, skipping weeks out', () => {
    const rows = [
      { player_id: 1, gameweek_id: 1, points: 10 },
      { player_id: 1, gameweek_id: 2, points: 2 },
      { player_id: 1, gameweek_id: 4, points: 3 },
      { player_id: 1, gameweek_id: 5, points: 5 },
      { player_id: 2, gameweek_id: 5, points: 7 },
      { player_id: 2, gameweek_id: 9, points: 50 }, // not a finished gameweek
    ];
    const form = formByPlayer(rows, [1, 2, 3, 4, 5]);
    expect(form.get(1)).toBe(3.3);
    expect(form.get(2)).toBe(7);
  });
});

describe('side form', () => {
  it('gives the last results, oldest first, ignoring games not yet played', () => {
    const f = (kickoff: string, gf: number | null, ga: number | null, side_id = 1) => ({
      side_id,
      kickoff,
      goals_for: gf,
      goals_against: ga,
    });
    const fixtures = [
      f('2026-09-19', 2, 1),
      f('2026-09-12', 0, 3),
      f('2026-09-26', 1, 1),
      f('2026-10-03', 4, 0),
      f('2026-10-10', null, null),
      f('2026-10-03', 0, 5, 2),
    ];
    expect(sideForm(fixtures, 1)).toEqual(['L', 'W', 'D', 'W']);
    expect(sideForm(fixtures, 1, 2)).toEqual(['D', 'W']);
    expect(sideForm(fixtures, 3)).toEqual([]);
  });
});
