import {
  flagHead,
  flagLine,
  flagShort,
  flaggedAgo,
  isActive,
  isStale,
  type PlayerFlag,
} from '@/lib/playerStatus';

const now = new Date('2026-11-15T20:00:00Z'); // Sun 15 Nov
const flag = (f: Partial<PlayerFlag>): PlayerFlag => ({
  status: 'out',
  note: null,
  back_by: null,
  set_at: '2026-11-13T10:00:00Z',
  ...f,
});

describe('player flags', () => {
  it('shows until the back-by day, then clears itself', () => {
    expect(isActive(flag({ back_by: '2026-11-16' }), now)).toBe(true);
    expect(isActive(flag({ back_by: '2026-11-15' }), now)).toBe(false);
    expect(isActive(flag({}), now)).toBe(true);
  });
  it('words it for the list and the player sheet', () => {
    expect(flagShort(flag({ back_by: '2026-12-05' }))).toBe('Out until 5 Dec');
    expect(flagShort(flag({ status: 'doubtful' }))).toBe('Doubtful');
    expect(flagHead(flag({ note: ' broken finger ' }))).toBe('Out: broken finger');
    expect(flagHead(flag({ status: 'doubtful' }))).toBe('Doubtful');
    expect(flagLine(flag({ back_by: '2026-12-05' }), now)).toBe(
      'Expected back Sat 5 Dec · flagged 2 days ago',
    );
    expect(flagLine(flag({ set_at: '2026-11-15T09:00:00Z' }), now)).toBe('flagged today');
  });
  it('counts days ago by the UK date', () => {
    expect(flaggedAgo('2026-11-14T22:00:00Z', now)).toBe('yesterday');
    expect(flaggedAgo('2026-10-25T10:00:00Z', now)).toBe('3 weeks ago');
  });
  it('calls a flag with no date stale after three weeks', () => {
    expect(isStale(flag({ set_at: '2026-10-20T10:00:00Z' }), now)).toBe(true);
    expect(isStale(flag({ set_at: '2026-11-10T10:00:00Z' }), now)).toBe(false);
    expect(isStale(flag({ set_at: '2026-10-20T10:00:00Z', back_by: '2026-12-01' }), now)).toBe(
      false,
    );
  });
});
