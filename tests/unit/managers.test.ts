import {
  matchChecks,
  matchesFilter,
  needsChecking,
  needsPosition,
  playersFilter,
  sidesWithoutKeeper,
  type MatchFacts,
  type PlayerFacts,
} from '@/lib/managers';

const played: MatchFacts = {
  goals_for: 4,
  goals_against: 1,
  eh_fixture_id: '123',
  lineup_imported_at: '2026-10-04T06:12:00Z',
  withheld_count: 0,
  stats_locked: false,
  stats_complete: false,
};
const evidence = { pitchero: true, potm: true, unnamed: 0 };

const player: PlayerFacts = {
  position: 'MID',
  active: true,
  needs_review: false,
  position_confirmed: false,
  name_withheld: false,
};

describe('match checks', () => {
  it('marks an upcoming match and nothing else', () => {
    const upcoming = { ...played, goals_for: null, goals_against: null };
    expect(matchChecks(upcoming, evidence)).toEqual([{ label: 'Upcoming', tone: 'muted' }]);
    expect(needsChecking(upcoming)).toBe(false);
  });

  it('lists what a played match has', () => {
    expect(matchChecks(played, evidence).map((c) => c.label)).toEqual([
      'Line-up',
      'Pitchero',
      'POTM',
    ]);
  });

  it('flags what is missing', () => {
    const checks = matchChecks(
      { ...played, lineup_imported_at: null, withheld_count: 2, stats_locked: true },
      { pitchero: false, potm: false, unnamed: 3 },
    );
    expect(checks).toEqual([
      { label: 'No line-up yet', tone: 'warn' },
      { label: 'No Pitchero', tone: 'muted' },
      { label: 'No POTM', tone: 'warn' },
      { label: '2 to add', tone: 'bad' },
      { label: '3 withheld', tone: 'bad' },
      { label: 'Locked', tone: 'muted' },
    ]);
  });

  it('calls a match without an England Hockey id manual', () => {
    const manual = { ...played, eh_fixture_id: null, lineup_imported_at: null };
    expect(matchChecks(manual, evidence)[0]).toEqual({ label: 'Manual', tone: 'muted' });
  });

  it('filters', () => {
    expect(matchesFilter(played, evidence, 'check')).toBe(true);
    expect(matchesFilter({ ...played, stats_complete: true }, evidence, 'check')).toBe(false);
    expect(matchesFilter(played, { ...evidence, unnamed: 1 }, 'withheld')).toBe(true);
    expect(matchesFilter(played, evidence, 'withheld')).toBe(false);
    expect(matchesFilter({ ...played, stats_locked: true }, evidence, 'locked')).toBe(true);
    expect(matchesFilter(played, evidence, 'upcoming')).toBe(false);
    expect(matchesFilter(played, evidence, 'all')).toBe(true);
  });
});

describe('players', () => {
  it('needs a position when new or still on the unconfirmed MID default', () => {
    expect(needsPosition(player)).toBe(true);
    expect(needsPosition({ ...player, position_confirmed: true })).toBe(false);
    expect(needsPosition({ ...player, position: 'DEF' })).toBe(false);
    expect(needsPosition({ ...player, active: false })).toBe(false);
    expect(needsPosition({ ...player, position: 'GK', needs_review: true, active: false })).toBe(
      true,
    );
  });

  it('finds sides with no active keeper', () => {
    const sides = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const players = [
      { ...player, side_id: 1, position: 'GK' as const },
      { ...player, side_id: 2, position: 'GK' as const, active: false },
      { ...player, side_id: 3, position: 'GK' as const, needs_review: true },
    ];
    expect(sidesWithoutKeeper(sides, players).map((s) => s.id)).toEqual([2, 3]);
  });

  it('filters', () => {
    expect(playersFilter({ ...player, name_withheld: true }, 'withheld', false)).toBe(true);
    expect(playersFilter(player, 'suggested', true)).toBe(true);
    expect(playersFilter({ ...player, active: false }, 'inactive', false)).toBe(true);
    expect(playersFilter({ ...player, active: false, needs_review: true }, 'inactive', false)).toBe(
      false,
    );
    expect(playersFilter(player, 'all', false)).toBe(true);
  });
});
