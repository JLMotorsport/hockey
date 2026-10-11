import { useId, useMemo, type ReactNode } from 'react';
import { Shirt } from '@/components/Pitch';
import { teamPitch } from '@/lib/hockeyPitch';
import type { Position } from '@/lib/scoring';
import { POSITION_RING } from './positions';

// V3's team view: a real hockey pitch, to scale, with each row standing on its
// line (keeper on the goal line, defenders on your 23, midfield on halfway,
// forwards on the opposition 23). Players are glowing badges in the club kit.

export interface Badge {
  key: string;
  position: Position;
  name: string;
  /** The line under the name: a fixture, a price, points... */
  data: ReactNode;
  /** 'points': glowing green (points in); 'muted': waiting or no game. */
  tone?: 'plain' | 'points' | 'muted';
  /** The side they play for, e.g. "M3". */
  side?: string;
  /** "C", "V" or a sub number. */
  mark?: string;
  dim?: boolean;
  highlight?: boolean;
  onClick?: () => void;
}

export function PlayerBadge({ b, size = 44 }: { b: Badge; size?: number }) {
  const ring = POSITION_RING[b.position];
  const inner = (
    <>
      <span
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: size,
          height: size,
          border: `1.5px solid ${ring}`,
          background:
            'radial-gradient(circle at 35% 30%, rgb(255 255 255 / .22), rgb(255 255 255 / .04) 60%), #0d1118',
          boxShadow: `0 0 18px -2px ${ring}88, inset 0 0 12px rgb(255 255 255 / .06)${b.highlight ? ', 0 0 0 3px #ffd400' : ''}`,
        }}
      >
        <Shirt keeper={b.position === 'GK'} className="h-[74%] w-[74%]" />
        {b.mark && (
          <span className="absolute -right-1 -top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white text-[10px] font-black text-[#05070c] shadow-[0_0_12px_rgb(255_255_255/.6)]">
            {b.mark}
          </span>
        )}
        {b.side && (
          <span className="v3-disp absolute -left-2 -top-[5px] h-4 min-w-[20px] rounded-md border border-white/35 bg-[#05070c] px-1 text-center text-[10px] leading-[15px] text-white">
            {b.side}
          </span>
        )}
      </span>
      <span className="max-w-[68px] truncate text-[11px] font-bold">{b.name}</span>
      <span
        className={`v3-num rounded-full px-2 text-[11px] leading-[17px] ${
          b.tone === 'points'
            ? 'bg-[rgb(var(--v3-mint))] text-[#04140c] shadow-[0_0_14px_rgb(63_242_168/.55)]'
            : b.tone === 'muted'
              ? 'bg-white/[0.06] text-[rgb(var(--v3-mut))]'
              : 'bg-white/10'
        }`}
      >
        {b.data}
      </span>
    </>
  );
  const cls = `flex w-[68px] flex-col items-center gap-1 ${b.dim ? 'opacity-55' : ''}`;
  return b.onClick ? (
    <button type="button" onClick={b.onClick} className={cls} aria-label={b.name}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function TeamPitch({
  rows,
  height,
  size = 44,
  bench,
}: {
  rows: Record<Position, Badge[]>;
  height: number;
  size?: number;
  bench?: Badge[];
}) {
  const id = useId().replace(/:/g, '');
  const width = 366;
  const d = useMemo(
    () => teamPitch({ width, height, labelRoom: Math.round(size * 0.5 + 44) }),
    [height, size],
  );
  const order: Position[] = ['GK', 'DEF', 'MID', 'FWD'];
  return (
    <div className="relative mx-auto w-[366px] max-w-full shrink-0" style={{ height }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0 overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`${id}t`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0a2a1f" />
            <stop offset=".85" stopColor="#05140f" />
            <stop offset="1" stopColor="#05140f" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${id}f`} cx="50%" cy="0%" r="75%">
            <stop offset="0" stopColor="rgb(127 231 255 / .16)" />
            <stop offset="1" stopColor="rgb(127 231 255 / 0)" />
          </radialGradient>
          <linearGradient id={`${id}m`} x1="0" y1="0" x2="0" y2="1">
            <stop offset=".86" stopColor="#fff" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={`${id}k`}>
            <rect width={width} height={height} fill={`url(#${id}m)`} />
          </mask>
        </defs>
        <g mask={`url(#${id}k)`}>
          <path d={d.turf} fill={`url(#${id}t)`} />
          <path d={d.turf} fill={`url(#${id}f)`} />
          <g
            fill="none"
            stroke="#7fe7ff"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity=".7"
            style={{ filter: 'drop-shadow(0 0 3px rgb(127 231 255 / .7))' }}
          >
            {[...d.lines, ...d.details].map((p, i) => (
              <path key={i} d={p} />
            ))}
            {d.goals.map((g, i) => (
              <path key={`g${i}`} d={g} stroke="#fff" fill="rgb(255 255 255 / .12)" />
            ))}
            {d.spots.map((s, i) => (
              <ellipse
                key={`s${i}`}
                cx={s.cx}
                cy={s.cy}
                rx={s.rx}
                ry={s.ry}
                fill="#7fe7ff"
                stroke="none"
              />
            ))}
          </g>
        </g>
      </svg>
      {order.map((pos) => (
        <div
          key={pos}
          className="absolute inset-x-0 flex justify-center gap-0.5"
          style={{ top: Math.round(d.rows[pos] - size / 2 - 1) }}
        >
          {rows[pos].map((b) => (
            <PlayerBadge key={b.key} b={b} size={size} />
          ))}
        </div>
      ))}
      {bench && (
        <div className="v3-glass absolute inset-x-0 top-[calc(100%+8px)] flex justify-center gap-0.5 rounded-[20px] pb-1.5 pt-2">
          <span className="v3-cap absolute left-3.5 top-2">Bench</span>
          {bench.map((b) => (
            <PlayerBadge key={b.key} b={{ ...b, dim: b.dim ?? true }} size={34} />
          ))}
        </div>
      )}
    </div>
  );
}
