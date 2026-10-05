// Timing for the opening screen: the pitch lines draw in once, at a steady
// pace, and always finish before the screen goes.

/** How long the full drawing takes. */
export const DRAW_MS = 2000;
/** How long the finished pitch stays before fading. */
export const HOLD_MS = 450;
/** The fade out. */
export const FADE_MS = 300;

/** How far one line (drawn between `from` and `to` of the whole) has got at progress p. */
export function lineProgress(p: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (p - from) / (to - from)));
}

/** Progress after `dt` ms: a steady pace whether or not the app is ready, stopping at fully drawn. */
export function advance(p: number, dt: number): number {
  return Math.min(1, p + dt / DRAW_MS);
}
