import { breakdown, points, type StatLine } from '@/lib/scoring';

const base: StatLine = {
  position: 'MID',
  goals: 0,
  assists: 0,
  green_cards: 0,
  yellow_cards: 0,
  red_cards: 0,
  player_of_match: false,
  goals_for: null,
  goals_against: null,
  is_home: true,
};

describe('points', () => {
  it('defender goal, clean sheet and a home win', () => {
    // 1 played + 6 goal + 4 clean sheet + 1 home win
    expect(points({ ...base, position: 'DEF', goals: 1, goals_for: 2, goals_against: 0 })).toBe(12);
  });

  it('an away win is worth 2', () => {
    const away = { ...base, goals_for: 3, goals_against: 1, is_home: false };
    expect(points(away)).toBe(1 + 2);
    expect(breakdown(away)).toContainEqual(['Away win', 2]);
    expect(breakdown({ ...away, is_home: true })).toContainEqual(['Home win', 1]);
  });

  it('goalkeeper loses a point per 2 conceded', () => {
    expect(points({ ...base, position: 'GK', goals_for: 0, goals_against: 6 })).toBe(1 - 3);
    expect(points({ ...base, position: 'GK', goals_for: 0, goals_against: 1 })).toBe(1);
  });

  it('forward cards, assists and player of the match in a draw', () => {
    const line = {
      ...base,
      position: 'FWD' as const,
      goals: 2,
      assists: 1,
      player_of_match: true,
      green_cards: 1,
      yellow_cards: 1,
      goals_for: 2,
      goals_against: 2,
    };
    expect(points(line)).toBe(1 + 8 + 3 + 3 - 1 - 2);
  });

  it('no result yet means no team points', () => {
    expect(points({ ...base, goals: 1 })).toBe(6);
  });

  it('red card', () => {
    expect(breakdown({ ...base, red_cards: 1 })).toContainEqual(['1 red card(s)', -4]);
  });
});
