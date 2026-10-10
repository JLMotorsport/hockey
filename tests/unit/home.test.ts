import { describe, expect, it } from 'vitest';
import { countdown, pendingLabel, liveGameweek, myPlace, ordinal, weekSpread } from '@/lib/home';

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

describe('pendingLabel', () => {
  const f = (
    id: number,
    side_id: number,
    synced: Partial<{ lineup: boolean; locked: boolean }> = {},
  ) => ({
    id,
    side_id,
    gameweek_id: 2,
    opponent: 'Lowestoft Railway 1',
    is_home: true,
    lineup_imported_at: synced.lineup ? '2026-10-10T18:30:00Z' : null,
    stats_locked: synced.locked ?? false,
  });
  const none = new Set<number>();
  it("shows the usual side's fixture until that match has synced, even with a score in", () => {
    const fixtures = [f(1, 1)];
    expect(pendingLabel(fixtures, 1, 2, { appeared: false, fixturesWithStats: none })).toBe(
      'LOW (H)',
    );
    // Played for another side that has synced: still waits for their own side.
    expect(pendingLabel(fixtures, 1, 2, { appeared: true, fixturesWithStats: none })).toBe(
      'LOW (H)',
    );
  });
  it('shows points (0 if they did not play) once the match has synced', () => {
    expect(
      pendingLabel([f(1, 1, { lineup: true })], 1, 2, { appeared: false, fixturesWithStats: none }),
    ).toBeNull();
    expect(
      pendingLabel([f(1, 1, { locked: true })], 1, 2, { appeared: false, fixturesWithStats: none }),
    ).toBeNull();
    // Stats entered by hand count as synced.
    expect(
      pendingLabel([f(1, 1)], 1, 2, { appeared: false, fixturesWithStats: new Set([1]) }),
    ).toBeNull();
  });
  it('waits for both games when a side plays twice', () => {
    const fixtures = [f(1, 1, { lineup: true }), f(2, 1)];
    expect(pendingLabel(fixtures, 1, 2, { appeared: false, fixturesWithStats: none })).toBe(
      '2 games',
    );
  });
  it('says No game when their side has none, unless they played for another side', () => {
    expect(pendingLabel([f(1, 1)], 3, 2, { appeared: false, fixturesWithStats: none })).toBe(
      'No game',
    );
    expect(pendingLabel([f(1, 1)], 3, 2, { appeared: true, fixturesWithStats: none })).toBeNull();
  });
});
