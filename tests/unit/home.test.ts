import { describe, expect, it } from 'vitest';
import { awaitingResult, countdown, liveGameweek, myPlace, ordinal, weekSpread } from '@/lib/home';

const gw = (id: number, start: string) => ({
  id,
  start_date: start,
  deadline: `${start}T09:00:00Z`,
});
const weeks = [gw(1, '2026-10-03'), gw(2, '2026-10-10'), gw(3, '2026-10-17')];

describe('liveGameweek', () => {
  it('is the gameweek from its deadline over the weekend', () => {
    expect(liveGameweek(weeks, new Date('2026-10-10T09:30:00Z'))?.id).toBe(2);
    expect(liveGameweek(weeks, new Date('2026-10-11T20:00:00Z'))?.id).toBe(2);
  });
  it('is nothing before the deadline or from the Monday', () => {
    expect(liveGameweek(weeks, new Date('2026-10-10T08:59:00Z'))).toBeUndefined();
    expect(liveGameweek(weeks, new Date('2026-10-13T10:00:00Z'))).toBeUndefined();
  });
});

describe('countdown', () => {
  const now = new Date('2026-10-08T11:00:00Z');
  it('counts days and hours, then hours and minutes', () => {
    expect(countdown('2026-10-10T09:00:00Z', now)).toBe('in 1 day 22 hrs');
    expect(countdown('2026-10-08T14:05:00Z', now)).toBe('in 3 hrs 5 mins');
    expect(countdown('2026-10-08T11:01:30Z', now)).toBe('in 1 min');
    expect(countdown('2026-10-08T10:00:00Z', now)).toBe('');
  });
});

describe('ordinal', () => {
  it('handles the teens', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '103rd',
    ]);
  });
});

describe('myPlace and weekSpread', () => {
  const rows = [
    { user_id: 'a', total: 100, latest: 10, rank: 1 },
    { user_id: 'b', total: 95, latest: 30, rank: 2 },
    { user_id: 'c', total: 80, latest: 2, rank: 3 },
  ];
  it('ranks within the league and shows movement', () => {
    expect(myPlace(rows, () => true, 'b')).toEqual({ rank: 2, of: 3, moved: 1 });
    expect(myPlace(rows, (u) => u !== 'a', 'b')).toEqual({ rank: 1, of: 2, moved: 1 });
    expect(myPlace(rows, (u) => u !== 'b', 'b')).toBeNull();
  });
  it('averages and finds the best week', () => {
    expect(weekSpread(rows)).toEqual({ average: 14, highest: 30 });
    expect(weekSpread([])).toEqual({ average: 0, highest: 0 });
  });
});

describe('awaitingResult', () => {
  const fixtures = [
    { side_id: 1, gameweek_id: 2, goals_for: null },
    { side_id: 2, gameweek_id: 2, goals_for: 3 },
  ];
  it('waits for a side whose game has no score yet', () => {
    expect(awaitingResult(fixtures, 1, 2, false)).toBe(true);
    expect(awaitingResult(fixtures, 1, 2, true)).toBe(false);
    expect(awaitingResult(fixtures, 2, 2, false)).toBe(false);
    expect(awaitingResult(fixtures, 3, 2, false)).toBe(false);
  });
});
