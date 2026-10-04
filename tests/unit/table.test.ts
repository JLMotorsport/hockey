import { movement } from '@/lib/table';

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
