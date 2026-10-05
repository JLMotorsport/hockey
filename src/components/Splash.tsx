import { useEffect, useRef, useState } from 'react';
import { advance, FADE_MS, HOLD_MS, lineProgress } from '@/lib/splash';

// The opening screen: a pitch whose lines draw themselves in the club's
// colours. The lines draw at a steady pace and always finish before it fades;
// if the app is slow, the finished pitch waits.

// The same geometry as PitchMarkings (a real 91.4m x 55m pitch).
const W = 550;
const H = 914;
const cx = W / 2;
const goalW = 36.6;
const r = 146.3;
const circle = (y: number, dir: 1 | -1, radius: number) => {
  const l = cx - goalW / 2;
  const rr = cx + goalW / 2;
  const sweep = dir === -1 ? 1 : 0;
  return `M ${l - radius} ${y} A ${radius} ${radius} 0 0 ${sweep} ${l} ${y + dir * radius} L ${rr} ${y + dir * radius} A ${radius} ${radius} 0 0 ${sweep} ${rr + radius} ${y}`;
};

// Each line draws between `from` and `to` of the whole (0 to 1).
const LINES: { d: string; from: number; to: number; dashed?: boolean }[] = [
  { d: `M 0 0 H ${W} V ${H} H 0 Z`, from: 0, to: 0.4 },
  { d: `M 0 ${H / 2} H ${W}`, from: 0.25, to: 0.5 },
  { d: `M 0 229 H ${W}`, from: 0.3, to: 0.55 },
  { d: `M 0 ${H - 229} H ${W}`, from: 0.3, to: 0.55 },
  { d: circle(0, 1, r), from: 0.45, to: 0.8 },
  { d: circle(H, -1, r), from: 0.45, to: 0.8 },
  { d: circle(0, 1, r + 50), from: 0.6, to: 0.95, dashed: true },
  { d: circle(H, -1, r + 50), from: 0.6, to: 0.95, dashed: true },
];

export function Splash({ done, onGone }: { done: boolean; onGone: () => void }) {
  const [p, setP] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const progress = useRef(0);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      progress.current = 1;
      setP(1);
      return;
    }
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      progress.current = advance(progress.current, now - last);
      last = now;
      setP(progress.current);
      if (progress.current < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Fully drawn and the app is ready: a beat to see it, then fade out.
  useEffect(() => {
    if (!(done && p >= 1) || leaving) return;
    const hold = setTimeout(() => setLeaving(true), HOLD_MS);
    return () => clearTimeout(hold);
  }, [done, p, leaving]);
  useEffect(() => {
    if (!leaving) return;
    const gone = setTimeout(onGone, FADE_MS);
    return () => clearTimeout(gone);
  }, [leaving, onGone]);

  const line = { stroke: 'white', strokeWidth: 3, fill: 'none', opacity: 0.9 };
  const marks = lineProgress(p, 0.85, 1);
  const crest = lineProgress(p, 0.5, 0.75);

  return (
    <div
      role="status"
      aria-label="Loading Fantasy Hockey"
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-brand px-10 text-white transition-opacity duration-300 ${leaving ? 'opacity-0' : 'opacity-100'}`}
    >
      <div
        className="relative w-[min(62vw,15rem)] overflow-hidden rounded-2xl bg-[#1b6e41] shadow-lg"
        style={{ aspectRatio: '590 / 954' }}
        aria-hidden="true"
      >
        <svg viewBox={`-20 -20 ${W + 40} ${H + 40}`} className="absolute inset-0 h-full w-full">
          <defs>
            <pattern id="splash-turf" width="550" height="114" patternUnits="userSpaceOnUse">
              <rect width="550" height="57" fill="#23864f" />
              <rect y="57" width="550" height="57" fill="#1f7a48" />
            </pattern>
            {/* Dashed arcs are revealed through a solid line drawing in a mask. */}
            {LINES.map(
              (l, i) =>
                l.dashed && (
                  <mask key={i} id={`splash-mask-${i}`} maskUnits="userSpaceOnUse">
                    <path
                      d={l.d}
                      stroke="white"
                      strokeWidth="10"
                      fill="none"
                      pathLength={1}
                      strokeDasharray="1"
                      strokeDashoffset={1 - lineProgress(p, l.from, l.to)}
                    />
                  </mask>
                ),
            )}
          </defs>
          <rect x="-20" y="-20" width={W + 40} height={H + 40} fill="#1b6e41" />
          <rect width={W} height={H} fill="url(#splash-turf)" />
          {LINES.map((l, i) =>
            l.dashed ? (
              <path
                key={i}
                d={l.d}
                {...line}
                strokeDasharray="10 12"
                mask={`url(#splash-mask-${i})`}
              />
            ) : (
              <path
                key={i}
                d={l.d}
                {...line}
                pathLength={1}
                strokeDasharray="1"
                strokeDashoffset={1 - lineProgress(p, l.from, l.to)}
              />
            ),
          )}
          {/* Penalty spots and goals appear last. */}
          <g opacity={marks}>
            <circle cx={cx} cy={64.7} r="5" fill="white" />
            <circle cx={cx} cy={H - 64.7} r="5" fill="white" />
            <rect x={cx - goalW / 2} y={-12} width={goalW} height="12" fill="white" />
            <rect x={cx - goalW / 2} y={H} width={goalW} height="12" fill="white" />
          </g>
        </svg>
        <div
          className="absolute left-1/2 top-1/2 flex h-[38%] w-[62%] items-center justify-center"
          style={{
            transform: `translate(-50%, -50%) scale(${0.85 + 0.15 * crest})`,
            opacity: crest,
          }}
        >
          <span className="flex aspect-square h-full items-center justify-center rounded-full bg-brand ring-4 ring-white">
            <img src="/crest.png" alt="" className="h-[72%] w-[72%] brightness-0 invert" />
          </span>
        </div>
      </div>
      <div className="text-center font-display uppercase leading-none">
        <p className="text-4xl font-extrabold">Fantasy Hockey</p>
        <p className="mt-1 text-sm font-bold tracking-[0.2em] text-white/80">Felixstowe HC</p>
      </div>
    </div>
  );
}
