import { advance, DRAW_MS, lineProgress } from '@/lib/splash';

describe('opening screen timing', () => {
  it('draws each line within its own share of the whole', () => {
    expect(lineProgress(0.1, 0.2, 0.6)).toBe(0);
    expect(lineProgress(0.4, 0.2, 0.6)).toBeCloseTo(0.5);
    expect(lineProgress(0.9, 0.2, 0.6)).toBe(1);
  });

  it('draws at a steady pace and stops at fully drawn', () => {
    expect(DRAW_MS).toBeGreaterThanOrEqual(1800);
    expect(advance(0, DRAW_MS / 2)).toBeCloseTo(0.5);
    expect(advance(0.9, DRAW_MS)).toBe(1);
  });
});
