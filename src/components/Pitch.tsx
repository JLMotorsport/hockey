import type { ReactNode } from 'react';
import type { Position } from '@/lib/scoring';

// A hockey pitch, portrait, our goal at the bottom. Proportions follow a real
// pitch (91.4m x 55m): shooting circles 14.63m from the goal, dashed 5m arcs
// outside them, 23m lines, centre line and penalty spots.
export function PitchMarkings() {
  const W = 550; // 55m
  const H = 914; // 91.4m
  const line = { stroke: 'white', strokeWidth: 3, fill: 'none', opacity: 0.85 };
  const goalW = 36.6; // 3.66m
  const cx = W / 2;
  const r = 146.3; // shooting circle
  // Circle: quarter arcs from each post plus the straight between the posts.
  const circle = (y: number, dir: 1 | -1, radius: number) => {
    const l = cx - goalW / 2;
    const rr = cx + goalW / 2;
    const sweep = dir === -1 ? 1 : 0;
    return `M ${l - radius} ${y} A ${radius} ${radius} 0 0 ${sweep} ${l} ${y + dir * radius} L ${rr} ${y + dir * radius} A ${radius} ${radius} 0 0 ${sweep} ${rr + radius} ${y}`;
  };
  return (
    <svg
      viewBox={`-20 -20 ${W + 40} ${H + 40}`}
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <pattern id="turf" width="550" height="114" patternUnits="userSpaceOnUse">
          <rect width="550" height="57" fill="#23864f" />
          <rect y="57" width="550" height="57" fill="#1f7a48" />
        </pattern>
      </defs>
      <rect x="-20" y="-20" width={W + 40} height={H + 40} fill="#1b6e41" />
      <rect width={W} height={H} fill="url(#turf)" />
      <rect width={W} height={H} {...line} />
      <line x1="0" y1={H / 2} x2={W} y2={H / 2} {...line} />
      <line x1="0" y1="229" x2={W} y2="229" {...line} />
      <line x1="0" y1={H - 229} x2={W} y2={H - 229} {...line} />
      <path d={circle(0, 1, r)} {...line} />
      <path d={circle(H, -1, r)} {...line} />
      <path d={circle(0, 1, r + 50)} {...line} strokeDasharray="10 12" />
      <path d={circle(H, -1, r + 50)} {...line} strokeDasharray="10 12" />
      <circle cx={cx} cy={64.7} r="4" fill="white" opacity="0.85" />
      <circle cx={cx} cy={H - 64.7} r="4" fill="white" opacity="0.85" />
      <rect x={cx - goalW / 2} y={-12} width={goalW} height="12" fill="white" opacity="0.9" />
      <rect x={cx - goalW / 2} y={H} width={goalW} height="12" fill="white" opacity="0.9" />
    </svg>
  );
}

/** The FHC shirt: white with red shoulders and collar; keepers in black. */
export function Shirt({
  keeper,
  empty,
  className = '',
}: {
  keeper?: boolean;
  empty?: boolean;
  className?: string;
}) {
  const body =
    'M14 6 L22 3 Q32 9 42 3 L50 6 L62 16 L55 27 L50 23 L50 58 L14 58 L14 23 L9 27 L2 16 Z';
  if (empty) {
    return (
      <svg viewBox="0 0 64 60" className={className} aria-hidden="true">
        <path
          d={body}
          fill="rgb(255 255 255 / 0.15)"
          stroke="white"
          strokeWidth="2"
          strokeDasharray="4 3"
        />
        <path d="M32 22 v16 M24 30 h16" stroke="white" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 60" className={className} aria-hidden="true">
      <path d={body} fill={keeper ? '#16181d' : '#ffffff'} stroke="#0003" strokeWidth="1" />
      {keeper ? (
        <path d="M22 3 Q32 9 42 3 L40 8 Q32 13 24 8 Z" fill="#d91414" />
      ) : (
        <>
          {/* Red shoulder panels and sleeves */}
          <path d="M14 6 L22 3 Q24 10 22 16 L14 23 L9 27 L2 16 Z" fill="#d91414" />
          <path d="M50 6 L42 3 Q40 10 42 16 L50 23 L55 27 L62 16 Z" fill="#d91414" />
          {/* Collar */}
          <path d="M22 3 Q32 9 42 3 L38 12 L32 17 L26 12 Z" fill="#d91414" />
        </>
      )}
    </svg>
  );
}

export interface PitchSlot {
  key: string;
  position: Position;
  /** Null for an empty slot. */
  name: string | null;
  sub?: ReactNode;
  captain?: boolean;
  onClick?: () => void;
}

/** Shirt plus name plate, as on the Premier League app. */
function PlayerSpot({ slot }: { slot: PitchSlot }) {
  const label = slot.name
    ? `${slot.name}${slot.captain ? ' (captain)' : ''}`
    : `Add ${slot.position}`;
  const inner = (
    <>
      <span className="relative">
        <Shirt
          keeper={slot.position === 'GK'}
          empty={!slot.name}
          className="h-12 w-12 drop-shadow sm:h-14 sm:w-14"
        />
        {slot.captain && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#16181d] font-display text-xs font-bold text-white ring-2 ring-white">
            C
          </span>
        )}
      </span>
      {slot.name ? (
        <span className="mt-0.5 w-full overflow-hidden rounded-md text-center shadow">
          <span className="block truncate bg-white px-1 py-0.5 text-[0.68rem] font-semibold leading-tight text-[#14181f] sm:text-xs">
            {slot.name}
          </span>
          {slot.sub !== undefined && (
            <span className="block bg-[#d91414] px-1 py-0.5 font-display text-[0.7rem] font-bold leading-tight text-white sm:text-xs">
              {slot.sub}
            </span>
          )}
        </span>
      ) : (
        <span className="mt-0.5 rounded-md bg-black/30 px-1.5 py-0.5 font-display text-[0.7rem] font-bold uppercase text-white">
          {slot.position}
        </span>
      )}
    </>
  );
  return slot.onClick ? (
    <button
      type="button"
      onClick={slot.onClick}
      aria-label={label}
      className="flex w-[4.6rem] flex-col items-center sm:w-24"
    >
      {inner}
    </button>
  ) : (
    <div aria-label={label} className="flex w-[4.6rem] flex-col items-center sm:w-24">
      {inner}
    </div>
  );
}

/** Players on the pitch: forwards at the top, keeper at the bottom. */
export function Pitch({ rows }: { rows: Record<Position, PitchSlot[]> }) {
  const order: Position[] = ['FWD', 'MID', 'DEF', 'GK'];
  return (
    <div
      className="relative mx-auto w-full max-w-[26rem] overflow-hidden rounded-2xl shadow-card"
      style={{ aspectRatio: '590 / 954' }}
    >
      <PitchMarkings />
      <div className="relative flex h-full flex-col justify-around px-1 py-6">
        {order.map((pos) => (
          <div key={pos} className="flex justify-center gap-0.5 sm:gap-2">
            {rows[pos].map((slot) => (
              <PlayerSpot key={slot.key} slot={slot} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
