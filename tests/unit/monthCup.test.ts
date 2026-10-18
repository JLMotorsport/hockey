import { cupDraw, roundName, seedOrder } from '@/lib/cup';
import { bestGameweek, monthsOf, monthTable } from '@/lib/month';

const gw = (id: number, start: string) => ({
  id,
  start_date: start,
  deadline: `${start}T09:00:00Z`,
});

describe('Manager of the Month', () => {
  it('groups gameweeks by the month they start in, from the restart', () => {
    const months = monthsOf(
      [gw(1, '2026-09-26'), gw(2, '2026-10-03'), gw(3, '2026-10-31'), gw(4, '2026-11-07')],
      '2026-10-01',
    );
    expect(months.map((m) => [m.label, m.gameweeks.map((g) => g.id)])).toEqual([
      ['October', [2, 3]],
      ['November', [4]],
    ]);
  });

  it('ranks the month and shows who moved since its last gameweek', () => {
    const managers = [
      { user_id: 'a', team_name: 'Alpha', display_name: 'A' },
      { user_id: 'b', team_name: 'Bravo', display_name: 'B' },
    ];
    const points = new Map([
      [
        'a',
        new Map([
          [2, 50],
          [3, 10],
        ]),
      ],
      [
        'b',
        new Map([
          [2, 40],
          [3, 30],
        ]),
      ],
    ]);
    const rows = monthTable(managers, points, [2, 3]);
    expect(rows.map((r) => [r.user_id, r.rank, r.points, r.move])).toEqual([
      ['b', 1, 70, 1],
      ['a', 2, 60, -1],
    ]);
    expect(monthTable(managers, points, [2]).every((r) => r.move === 0)).toBe(true);
    expect(bestGameweek(managers, points, [2, 3])).toMatchObject({ points: 50, gameweekId: 2 });
  });
});

describe('the Cup', () => {
  it('seeds so the top two can only meet in the final', () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(roundName(8, false)).toBe('Quarter-finals');
    expect(roundName(32, true)).toBe('First round');
  });

  it('gives the top seeds byes, then the higher score goes through, a tie to the higher seed', () => {
    // 5 entrants: an 8-team draw, seeds 1-3 get byes; 4 plays 5.
    const scores: Record<number, Record<number, number>> = {
      10: { 4: 30, 5: 40 },
      11: { 1: 50, 5: 50, 2: 20, 3: 60 },
    };
    const rounds = cupDraw(
      5,
      [10, 11, 12],
      (seed, g) => scores[g]?.[seed],
      (g) => g !== 12,
    );
    expect(rounds.map((r) => r.name)).toEqual(['Quarter-finals', 'Semi-finals', 'Final']);
    expect(rounds[0]!.ties.map((t) => t.winner)).toEqual([1, 5, 2, 3]);
    // 1 v 5 level on 50: the higher seed (1) goes through; 3 beats 2.
    expect(rounds[1]!.ties.map((t) => t.winner)).toEqual([1, 3]);
    // The final isn't decided yet.
    expect(rounds[2]!.ties[0]).toMatchObject({ a: 1, b: 3 });
    expect(rounds[2]!.ties[0]!.winner).toBeUndefined();
  });

  it('leaves later ties open until earlier ones are decided', () => {
    const rounds = cupDraw(
      4,
      [10, 11],
      () => 10,
      () => false,
    );
    expect(rounds[1]!.ties[0]).toMatchObject({ a: undefined, b: undefined });
  });
});
