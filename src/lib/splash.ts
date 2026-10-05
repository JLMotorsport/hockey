// Timing for the opening screen: the pitch lines draw in once, and always
// finish before the screen goes.

/** How long the full drawing takes at its normal pace. */
export const DRAW_MS = 1200;
/** Once the app is ready, whatever is left is drawn within this. */
export const FINISH_MS = 400;

/** How far one line (drawn between `from` and `to` of the whole) has got at progress p. */
export function lineProgress(p: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (p - from) / (to - from)));
}

/**
 * Progress after `dt` ms. Normal pace while loading; once ready, fast enough
 * to finish what's left within FINISH_MS (never slower than normal).
 * `readyAt` is the progress when the app became ready (null while loading).
 */
export function advance(p: number, dt: number, readyAt: number | null): number {
  const normal = 1 / DRAW_MS;
  const speed = readyAt === null ? normal : Math.max(normal, (1 - readyAt) / FINISH_MS);
  return Math.min(1, p + dt * speed);
}
