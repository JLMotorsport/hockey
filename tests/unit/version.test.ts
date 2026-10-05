import { BUILD_COMMIT, BUILD_LABEL, buildLabel } from '@/lib/version';

describe('build label', () => {
  it('shows the build time in UK time', () => {
    expect(buildLabel('2026-10-05T16:40:00Z')).toBe('5 Oct 17:40');
    expect(buildLabel('2026-12-01T09:05:00Z')).toBe('1 Dec 09:05');
  });

  it('is baked into the build', () => {
    expect(BUILD_LABEL).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{2}:\d{2}$/);
    expect(BUILD_COMMIT).toMatch(/^([0-9a-f]{7}|dev)$/);
  });
});
