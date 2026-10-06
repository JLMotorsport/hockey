import { seasonStats, sortBy, type StatRow } from '@/lib/playerStats';

const row = (player_id: number, extra: Partial<StatRow> = {}): StatRow => ({
  player_id,
  goals: 0,
  assists: 0,
  green_cards: 0,
  yellow_cards: 0,
  red_cards: 0,
  player_of_match: false,
  goals_against: 1,
  ...extra,
});

describe('season stats', () => {
  it('adds up each player', () => {
    const s = seasonStats([
      row(1, { goals: 2, player_of_match: true, goals_against: 0 }),
      row(1, { goals: 1, assists: 1, green_cards: 1 }),
      row(2, { goals_against: null, yellow_cards: 1 }),
    ]);
    expect(s.get(1)).toEqual({
      apps: 2,
      goals: 3,
      assists: 1,
      potm: 1,
      cleanSheets: 1,
      green: 1,
      yellow: 0,
      red: 0,
    });
    // No score yet is not a clean sheet.
    expect(s.get(2)).toMatchObject({ apps: 1, cleanSheets: 0, yellow: 1 });
  });

  it('sorts highest first, flips, and puts blanks last', () => {
    const items = [
      { id: 1, v: 3 },
      { id: 2, v: null },
      { id: 3, v: 7 },
    ];
    expect(sortBy(items, (x) => x.v, 'desc').map((x) => x.id)).toEqual([3, 1, 2]);
    expect(sortBy(items, (x) => x.v, 'asc').map((x) => x.id)).toEqual([1, 3, 2]);
  });
});
