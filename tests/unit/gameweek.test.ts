import { defaultGameweek, ukToday } from '@/lib/gameweek';

// GW1 on Sat 3 Oct 2026, GW2 on Sat 10 Oct; deadlines 10:00 UK (09:00 UTC).
const gws = [
  { id: 1, start_date: '2026-10-03', deadline: '2026-10-03T09:00:00Z' },
  { id: 2, start_date: '2026-10-10', deadline: '2026-10-10T09:00:00Z' },
];

describe('defaultGameweek', () => {
  it('shows the gameweek being played over the weekend', () => {
    expect(defaultGameweek(gws, new Date('2026-10-03T15:00:00Z'))?.id).toBe(1); // Sat
    expect(defaultGameweek(gws, new Date('2026-10-04T22:30:00Z'))?.id).toBe(1); // Sun 23:30 UK
  });

  it('moves to the next gameweek on Monday', () => {
    expect(defaultGameweek(gws, new Date('2026-10-04T23:30:00Z'))?.id).toBe(2); // Mon 00:30 UK
    expect(defaultGameweek(gws, new Date('2026-10-08T12:00:00Z'))?.id).toBe(2);
  });

  it('before the first deadline, shows the first gameweek', () => {
    expect(defaultGameweek(gws, new Date('2026-10-01T12:00:00Z'))?.id).toBe(1);
  });

  it('after the last gameweek, stays on it', () => {
    expect(defaultGameweek(gws, new Date('2026-10-20T12:00:00Z'))?.id).toBe(2);
  });

  it('uses the UK date', () => {
    expect(ukToday(new Date('2026-10-04T23:30:00Z'))).toBe('2026-10-05');
  });
});
