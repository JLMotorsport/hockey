import { teamOfTheWeek, type Scorer } from '@/lib/teamOfWeek';

let id = 0;
const s = (position: Scorer['position'], points: number): Scorer => ({
  player_id: ++id,
  name: `P${id}`,
  position,
  points,
});

describe('teamOfTheWeek', () => {
  it('picks the formation that scores most', () => {
    const scorers = [
      s('GK', 5),
      s('GK', 2),
      ...[6, 5, 4, 1, 1].map((p) => s('DEF', p)),
      ...[8, 7, 6, 5, 2].map((p) => s('MID', p)),
      ...[12, 11, 10, 0].map((p) => s('FWD', p)),
    ];
    const best = teamOfTheWeek(scorers, ['4-4-2', '4-3-3', '3-4-3'])!;
    // 3-4-3: GK 5 + DEF 15 + MID 26 + FWD 33 = 79 beats 4-3-3 (5+16+21+33=75) and 4-4-2.
    expect(best.formation).toBe('3-4-3');
    expect(best.total).toBe(79);
    expect(best.picks).toHaveLength(11);
    expect(best.picks.filter((p) => p.position === 'GK').map((p) => p.points)).toEqual([5]);
  });

  it('keeps to the allowed formations', () => {
    const scorers = [
      s('GK', 1),
      ...Array.from({ length: 6 }, () => s('FWD', 10)),
      ...Array.from({ length: 6 }, () => s('DEF', 1)),
      ...Array.from({ length: 6 }, () => s('MID', 1)),
    ];
    expect(teamOfTheWeek(scorers, ['4-4-2'])!.formation).toBe('4-4-2');
  });

  it('fills as far as it can when a position is short', () => {
    const best = teamOfTheWeek([s('MID', 3), s('FWD', 2)], ['4-4-2'])!;
    expect(best.picks).toHaveLength(2);
    expect(best.total).toBe(5);
  });

  it('returns nothing without scorers', () => {
    expect(teamOfTheWeek([], ['4-4-2'])).toBeNull();
  });
});
