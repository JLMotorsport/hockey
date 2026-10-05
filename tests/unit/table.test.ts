import { inLeague, leagueRows, movement } from '@/lib/table';

describe('league table movement', () => {
  it('compares with the table before the latest gameweek', () => {
    const rows = [
      { user_id: 'a', total: 100, latest: 50, rank: 1 }, // was 3rd on 50
      { user_id: 'b', total: 90, latest: 10, rank: 2 }, // was 1st on 80
      { user_id: 'c', total: 80, latest: 20, rank: 3 }, // was 2nd on 60
    ];
    const m = movement(rows);
    expect(m.get('a')).toBe(2);
    expect(m.get('b')).toBe(-1);
    expect(m.get('c')).toBe(-1);
  });
});

describe('mini leagues', () => {
  const sides = [
    { id: 1, name: "Men's 1s", short_name: 'M1' },
    { id: 2, name: "Men's 2s", short_name: 'M2' },
    { id: 5, name: "Women's 1s", short_name: 'W1' },
  ];
  const sideOf = new Map<string, number | null>([
    ['a', 1],
    ['b', 5],
    ['c', 2],
    ['d', null],
  ]);
  const rows = ['a', 'b', 'c', 'd'].map((user_id, i) => ({
    user_id,
    total: 100 - i * 10,
    latest: 10,
    rank: i + 1,
  }));

  it('splits by men, women and side, ranking each from 1', () => {
    const ids = (key: Parameters<typeof inLeague>[0]) =>
      leagueRows(rows, inLeague(key, sideOf, sides)).map((r) => `${r.user_id}${r.rank}`);
    expect(ids('all')).toEqual(['a1', 'b2', 'c3', 'd4']);
    expect(ids('men')).toEqual(['a1', 'c2']);
    expect(ids('women')).toEqual(['b1']);
    expect(ids('side:2')).toEqual(['c1']);
  });
});
