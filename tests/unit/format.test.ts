import { gameweekLabel, shortName, toUkInputValue } from '@/lib/format';
import { lockedGameweeks, nextOpenGameweek } from '@/lib/queries';
import { parsePlayerLines } from '@/lib/players';

describe('UK times', () => {
  it('shows summer and winter deadlines in UK wall-clock time', () => {
    expect(toUkInputValue('2026-10-10T09:00:00Z')).toBe('2026-10-10T10:00'); // BST
    expect(toUkInputValue('2026-12-05T10:00:00Z')).toBe('2026-12-05T10:00'); // GMT
  });
});

describe('gameweeks', () => {
  const gws = [
    { id: 3, start_date: '2026-09-26', deadline: '2026-09-26T09:00:00Z' },
    { id: 1, start_date: '2026-09-12', deadline: '2026-09-12T09:00:00Z' },
    { id: 2, start_date: '2026-09-19', deadline: '2026-09-19T09:00:00Z' },
  ];

  it('numbers by date', () => {
    expect(gameweekLabel(gws[0]!, gws)).toMatch(/^GW3 \(26 Sep/);
  });

  it('splits locked and open', () => {
    const sorted = [...gws].sort((a, b) => a.start_date.localeCompare(b.start_date));
    const now = new Date('2026-09-20T00:00:00Z');
    expect(nextOpenGameweek(sorted, now)?.id).toBe(3);
    expect(lockedGameweeks(sorted, now).map((g) => g.id)).toEqual([1, 2]);
  });
});

describe('parsePlayerLines', () => {
  const sides = [
    { id: 1, name: "Men's 1s", short_name: 'M1' },
    { id: 6, name: "Women's 2s", short_name: 'W2' },
  ];

  it('parses good lines and reports bad ones', () => {
    const { rows, problems } = parsePlayerLines(
      'Jo Bloggs, MID, M1, 8.5\nbad line\nSam Keeper, gk, w2, 6\nX, ZZ, M1, 5',
      sides,
    );
    expect(rows).toEqual([
      { name: 'Jo Bloggs', position: 'MID', side_id: 1, price: 85 },
      { name: 'Sam Keeper', position: 'GK', side_id: 6, price: 60 },
    ]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/Line 2/);
  });
});

describe('shortName', () => {
  it('fits names under a shirt', () => {
    expect(shortName('Jamie Smith')).toBe('J. Smith');
    expect(shortName('Rebecca El-Mahraoui')).toBe('R. El-Mahraoui');
    expect(shortName('Name withheld #5 (M3)')).toBe('Withheld #5');
    expect(shortName('Name withheld #b27e (W2)')).toBe('Withheld #b27e');
  });
});
