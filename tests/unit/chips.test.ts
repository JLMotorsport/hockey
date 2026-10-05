import { chipStates, seasonHalf, seasonOf } from '@/lib/chips';

const gws = [
  { id: 1, start_date: '2026-10-03' },
  { id: 2, start_date: '2026-10-10' },
  { id: 3, start_date: '2027-01-09' },
  { id: 4, start_date: '2027-01-16' },
];

describe('chips', () => {
  it('splits the season at New Year', () => {
    expect(seasonHalf('2026-12-26')).toBe(1);
    expect(seasonHalf('2027-01-02')).toBe(2);
  });

  it('marks chips active, used or available', () => {
    const s = chipStates(
      [
        { chip: 'triple_captain', gameweek_id: 1, side_id: null },
        { chip: 'team_bus', gameweek_id: 2, side_id: 7 },
      ],
      gws,
      2,
    );
    expect(s.triple_captain).toEqual({ state: 'used', gameweekId: 1 });
    expect(s.team_bus).toEqual({ state: 'active', sideId: 7 });
    expect(s.rolling_subs).toEqual({ state: 'available' });
  });

  it('gives a wildcard for each half of the season', () => {
    const played = [{ chip: 'wildcard', gameweek_id: 1, side_id: null }];
    expect(chipStates(played, gws, 2).wildcard.state).toBe('used');
    expect(chipStates(played, gws, 4).wildcard.state).toBe('available');
  });

  it('gives every chip back next season', () => {
    expect(seasonOf('2026-07-04')).toBe(2026);
    expect(seasonOf('2027-06-26')).toBe(2026);
    expect(seasonOf('2027-07-03')).toBe(2027);
    const next = [...gws, { id: 5, start_date: '2027-09-11' }];
    const played = [
      { chip: 'triple_captain', gameweek_id: 1, side_id: null },
      { chip: 'wildcard', gameweek_id: 2, side_id: null },
    ];
    expect(chipStates(played, next, 5).triple_captain.state).toBe('available');
    expect(chipStates(played, next, 5).wildcard.state).toBe('available');
  });
});
