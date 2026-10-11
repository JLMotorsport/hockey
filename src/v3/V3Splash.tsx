import { useEffect, useMemo, useState } from 'react';
import { fullPitch } from '@/lib/hockeyPitch';

// V3's opening (approved board "Opening A"): floodlights swing on, a real
// hockey pitch draws itself, the badge snaps in. It's all done in under a
// second; it then waits only as long as the app needs, and fades.

const DRAWN_MS = 950;
const FADE_MS = 220;

export function V3Splash({ done, onGone }: { done: boolean; onGone: () => void }) {
  const [drawn, setDrawn] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const pitch = useMemo(() => fullPitch({ width: 340, top: 0, bottom: 300, cx: 170 }), []);

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => setDrawn(true), reduced ? 0 : DRAWN_MS);
    return () => clearTimeout(t);
  }, []);
  // Drawn and the app is ready: fade out, then go.
  useEffect(() => {
    if (drawn && done) setLeaving(true);
  }, [drawn, done]);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(onGone, FADE_MS);
    return () => clearTimeout(t);
  }, [leaving, onGone]);

  return (
    <div
      className="v3 fixed inset-0 z-[100] overflow-hidden transition-opacity"
      style={{ opacity: leaving ? 0 : 1, transitionDuration: `${FADE_MS}ms` }}
      aria-label="Loading"
      role="status"
    >
      <span className="v3s-beam left-[-30px] [--r:-24deg]" />
      <span className="v3s-beam right-[-30px] [--r:24deg] [animation-delay:80ms]" />
      <div className="absolute inset-x-0 top-[calc(50%-110px)] flex flex-col items-center gap-3.5">
        <span className="v3-red v3-glow v3-disp v3s-crest flex h-[92px] w-[92px] items-center justify-center rounded-[28px] text-[34px]">
          FHC
        </span>
        <span className="v3-disp v3s-word text-[40px] tracking-[.06em]">Fantasy hockey</span>
        <span className="v3-cap v3s-word [animation-delay:60ms]">Felixstowe Hockey Club</span>
      </div>
      <svg
        width="340"
        height="310"
        viewBox="0 -6 340 312"
        className="absolute bottom-[max(40px,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 overflow-visible"
        aria-hidden="true"
      >
        <path d={pitch.turf} fill="rgb(10 40 30 / .6)" />
        <g
          fill="none"
          stroke="#7fe7ff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: 'drop-shadow(0 0 4px #7fe7ff)' }}
        >
          {pitch.lines.map((d, i) => (
            <path key={i} d={d} pathLength={1} className="v3s-line" />
          ))}
          {pitch.details.map((d, i) => (
            <path key={`d${i}`} d={d} className="v3s-fade" />
          ))}
          {pitch.goals.map((d, i) => (
            <path
              key={`g${i}`}
              d={d}
              stroke="#fff"
              fill="rgb(255 255 255 / .14)"
              className="v3s-fade"
            />
          ))}
          {pitch.spots.map((s, i) => (
            <ellipse
              key={`s${i}`}
              cx={s.cx}
              cy={s.cy}
              rx={s.rx}
              ry={s.ry}
              fill="#7fe7ff"
              stroke="none"
              className="v3s-fade"
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
