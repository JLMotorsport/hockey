import { dueKind, reminderText, ukTime } from '../../supabase/functions/_shared/reminders';

describe('deadline reminders', () => {
  const deadline = new Date('2026-10-24T09:30:00Z'); // Sat 10:30 UK (BST)

  it('reads the UK clock, summer time included', () => {
    expect(ukTime(deadline)).toMatchObject({ date: '2026-10-24', clock: '10:30' });
  });

  it('is due at 7pm the evening before, and an hour before', () => {
    expect(dueKind(new Date('2026-10-23T18:05:00Z'), deadline)).toBe('eve'); // 19:05 UK Friday
    expect(dueKind(new Date('2026-10-23T17:05:00Z'), deadline)).toBeNull(); // 18:05
    // 8pm and 9pm are retries if the 7pm run failed (reminder_log: once only).
    expect(dueKind(new Date('2026-10-23T20:05:00Z'), deadline)).toBe('eve'); // 21:05
    expect(dueKind(new Date('2026-10-23T21:05:00Z'), deadline)).toBeNull(); // 22:05
    expect(dueKind(new Date('2026-10-24T08:05:00Z'), deadline)).toBe('soon'); // 85 minutes before
    // Still 'soon' 25 minutes out (reminder_log makes sure it only goes once), not inside 20.
    expect(dueKind(new Date('2026-10-24T09:05:00Z'), deadline)).toBe('soon');
    expect(dueKind(new Date('2026-10-24T09:15:00Z'), deadline)).toBeNull();
  });

  it('says what matters: free transfers and starters with no game', () => {
    expect(
      reminderText('eve', 7, deadline, {
        has_squad: true,
        free: 2,
        no_game: ['P. List', 'M. Vagner'],
      }),
    ).toEqual({
      title: 'GW7 deadline tomorrow, 10:30',
      body: '2 free transfers. 2 of your starters have no game: P. List, M. Vagner.',
    });
    expect(
      reminderText('soon', 7, deadline, { has_squad: false, free: 2, no_game: [] }).body,
    ).toMatch(/haven't picked a team/);
  });
});
