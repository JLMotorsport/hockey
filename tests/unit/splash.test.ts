import { advance, DRAW_MS, FINISH_MS, lineProgress } from '@/lib/splash';

describe('opening screen timing', () => {
  it('draws each line within its own share of the whole', () => {
    expect(lineProgress(0.1, 0.2, 0.6)).toBe(0);
    expect(lineProgress(0.4, 0.2, 0.6)).toBeCloseTo(0.5);
    expect(lineProgress(0.9, 0.2, 0.6)).toBe(1);
  });

  it('takes the full time while still loading, and stops at fully drawn', () => {
    expect(advance(0, DRAW_MS / 2, null)).toBeCloseTo(0.5);
    expect(advance(0.9, DRAW_MS, null)).toBe(1);
  });

  it('finishes what is left quickly once the app is ready', () => {
    // Ready at 20%: the remaining 80% takes FINISH_MS, not 960ms.
    let p = 0.2;
    for (let t = 0; t < FINISH_MS; t += 10) p = advance(p, 10, 0.2);
    expect(p).toBe(1);
  });
});
