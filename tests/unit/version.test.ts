import { BUILD_COMMIT, BUILD_LABEL, buildLabel } from '@/lib/version';

describe('build label', () => {
  it('shows the build time in UK time', () => {
    expect(buildLabel('2026-10-05T16:40:00Z')).toBe('5101740');
    expect(buildLabel('2026-12-01T09:05:00Z')).toBe('1120905');
    // 11 Jan and 1 Nov stay different.
    expect(buildLabel('2027-01-11T12:00:00Z')).toBe('11011200');
    expect(buildLabel('2026-11-01T12:00:00Z')).toBe('1111200');
  });

  it('is baked into the build', () => {
    expect(BUILD_LABEL).toMatch(/^\d{7,8}$/);
    expect(BUILD_COMMIT).toMatch(/^([0-9a-f]{7}|dev)$/);
  });
});
