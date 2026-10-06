import type { ReactNode } from 'react';
import type { Position } from '@/lib/scoring';

// Our half of a hockey pitch as FPL draws a football one: seen from behind
// the goal in perspective, boards behind it, goal at the top. Real hockey
// geometry (55m wide; shooting circle 14.63m from the posts, dashed 5m arc
// outside it, penalty spot 6.475m out, 23m line, centre line at 45.7m),
// projected so the far end is narrower. Drawn into a 1000 x 1000 box that is
// stretched to fit, with lines that keep their width.
const PW = 55; // metres across
const PL = 45.7; // metres to the centre line
const TOP = 0.11; // backline, as a share of the height (boards and goal above)
const BOTTOM = 0.985; // centre line
const NEAR = 0.84; // width of the backline compared with the centre line

function project(xm: number, ym: number): [number, number] {
  const v = TOP + (BOTTOM - TOP) * (ym / PL);
  const k = NEAR + (1 - NEAR) * ((v - TOP) / (BOTTOM - TOP));
  return [500 + (xm / PW - 0.5) * 940 * k, v * 1000];
}

function path(points: [number, number][]): string {
  return points
    .map(([x, y], i) => {
      const [px, py] = project(x, y);
      return `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`;
    })
    .join(' ');
}

const straight = (x1: number, y1: number, x2: number, y2: number, n = 16) =>
  path(
    Array.from({ length: n + 1 }, (_, i) => [x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n]),
  );

/** The D: quarter circles from each post joined by a straight. */
function circleD(r: number): string {
  const l = PW / 2 - 1.83;
  const rr = PW / 2 + 1.83;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = Math.PI - (Math.PI / 2) * (i / 24);
    pts.push([l + r * Math.cos(t), r * Math.sin(t)]);
  }
  for (let i = 0; i <= 24; i++) {
    const t = Math.PI / 2 - (Math.PI / 2) * (i / 24);
    pts.push([rr + r * Math.cos(t), r * Math.sin(t)]);
  }
  return path(pts);
}

export function PitchMarkings({ stretch = false }: { stretch?: boolean }) {
  void stretch; // always stretched now; kept so callers needn't change
  const line = {
    stroke: 'white',
    strokeWidth: 2.5,
    fill: 'none',
    opacity: 0.9,
    vectorEffect: 'non-scaling-stroke' as const,
  };
  const [spotX, spotY] = project(PW / 2, 6.475);
  const [gl] = project(PW / 2 - 1.83, 0);
  const [gr] = project(PW / 2 + 1.83, 0);
  const [, back] = project(0, 0);
  const goalTop = back - 34;
  // Stripes across the grass, deeper towards the viewer.
  const stripes = Array.from({ length: 9 }, (_, i) => {
    const y0 = project(0, (PL / 8) * (i - 1))[1];
    const y1 = project(0, (PL / 8) * i)[1];
    return { y: i === 0 ? 0 : y0, h: y1 - (i === 0 ? 0 : y0), dark: i % 2 === 0 };
  });
  return (
    <svg
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <pattern id="net" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M0 0L10 10M10 0L0 10" stroke="white" strokeWidth="1" opacity="0.55" />
        </pattern>
        <linearGradient id="boards" x1="0" x2="1">
          <stop offset="0" stopColor="#d91414" />
          <stop offset="1" stopColor="#a50f0f" />
        </linearGradient>
      </defs>
      <rect width="1000" height="1000" fill="#1f8a4c" />
      {stripes.map((st, i) => (
        <rect key={i} y={st.y} width="1000" height={st.h} fill={st.dark ? '#1b7a43' : '#239552'} />
      ))}
      {/* Boards behind the goal */}
      <rect x="40" y="0" width="920" height={goalTop - 6} rx="6" fill="url(#boards)" />
      {/* Goal: backboard, net and posts */}
      <rect
        x={gl}
        y={goalTop}
        width={gr - gl}
        height={back - goalTop}
        fill="#cfd8d3"
        opacity="0.35"
      />
      <rect x={gl} y={goalTop} width={gr - gl} height={back - goalTop} fill="url(#net)" />
      <path
        d={`M${gl} ${back} V${goalTop} H${gr} V${back}`}
        {...line}
        strokeWidth={4}
        opacity={1}
      />
      {/* Lines */}
      <path d={straight(0, 0, PW, 0)} {...line} />
      <path d={straight(0, 0, 0, PL)} {...line} />
      <path d={straight(PW, 0, PW, PL)} {...line} />
      <path d={straight(0, 22.9, PW, 22.9)} {...line} />
      <path d={straight(0, PL, PW, PL)} {...line} />
      <path d={circleD(14.63)} {...line} />
      <path d={circleD(19.63)} {...line} strokeDasharray="7 9" />
      <ellipse cx={spotX} cy={spotY} rx="5" ry="4" fill="white" opacity="0.9" />
    </svg>
  );
}

/** Text on the boards behind the goal (HTML, so it isn't stretched). */
function Boards() {
  return (
    <div className="pointer-events-none absolute inset-x-[4%] top-0 flex h-[7%] items-center justify-between px-[3%] font-display text-[0.6rem] font-extrabold uppercase tracking-[0.2em] text-white/90 sm:text-xs">
      {/* Short on phones, where the keepers' price tags sit over the boards. */}
      <span>
        <span className="sm:hidden">FHC</span>
        <span className="hidden sm:inline">Felixstowe HC</span>
      </span>
      <span>
        <span className="sm:hidden">FHC</span>
        <span className="hidden sm:inline">Felixstowe HC</span>
      </span>
    </div>
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
      {/* Shirt sponsors, as on the real kit: Diamond Mills, then Hutton. */}
      <rect
        x="21"
        y="22"
        width="22"
        height="7"
        rx="0.8"
        fill="#ffe100"
        stroke="#16181d"
        strokeWidth="0.7"
      />
      <text
        x="32"
        y="27.2"
        textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontWeight="700"
        fontSize="3.6"
        fill="#16181d"
        textLength="19"
        lengthAdjust="spacingAndGlyphs"
      >
        DIAMOND MILLS
      </text>
      <rect x="22" y="31.5" width="20" height="8.5" fill={keeper ? '#ffffff' : 'none'} />
      <text
        x="32"
        y="37.6"
        textAnchor="middle"
        fontFamily="Archivo, Arial, sans-serif"
        fontWeight="700"
        fontSize="6.4"
        fill="#16181d"
        textLength="16"
        lengthAdjust="spacingAndGlyphs"
      >
        Hutton
      </text>
      <rect x="23.5" y="38.6" width="17" height="1.8" fill="#d91414" />
    </svg>
  );
}

export interface PitchSlot {
  key: string;
  position: Position;
  /** Null for an empty slot. */
  name: string | null;
  /** Shown on the name line, e.g. the player's side ("M3"). */
  tag?: string;
  sub?: ReactNode;
  /** Grey strip instead of red, e.g. "No game". */
  subMuted?: boolean;
  captain?: boolean;
  /** Small badge on the shirt; defaults to "C" for the captain. */
  badge?: string;
  /** Text for an empty slot instead of the position, e.g. "Sub 1". */
  label?: string;
  /** Small label above the shirt, e.g. a sub's position. */
  heading?: string;
  /** Show the heading as a dark pill (on the pitch) rather than plain text (on the bench). */
  headingPill?: boolean;
  /** Ringed while choosing who to swap with. */
  highlight?: boolean;
  /** Greyed out, e.g. a starter who was subbed off. */
  faded?: boolean;
  onClick?: () => void;
}

/** Shirt plus name plate, as on the Premier League app. */
function PlayerSpot({ slot, compact = false }: { slot: PitchSlot; compact?: boolean }) {
  const label = slot.name
    ? `${slot.name}${slot.captain ? ' (captain)' : ''}`
    : `Add ${slot.label ?? slot.position}`;
  const inner = (
    <>
      {slot.heading !== undefined && (
        <span
          className={
            slot.headingPill
              ? 'mb-0.5 rounded bg-black/55 px-1.5 font-display text-xs font-bold text-white'
              : `font-display font-extrabold uppercase tracking-wider text-[#1b6e41] ${compact ? 'mb-1 text-[0.6rem] leading-tight sm:mb-0.5 sm:text-xs' : 'mb-0.5 text-xs'}`
          }
        >
          {slot.heading || '\u00a0'}
        </span>
      )}
      <span className="relative">
        <Shirt
          keeper={slot.position === 'GK'}
          empty={!slot.name}
          className={`${compact ? 'h-8 w-8' : 'h-12 w-12'} drop-shadow sm:h-14 sm:w-14`}
        />
        {(slot.captain || slot.badge) && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#16181d] font-display text-xs font-bold text-white ring-2 ring-white">
            {slot.badge ?? 'C'}
          </span>
        )}
      </span>
      {slot.name ? (
        <span className={`relative ${compact ? 'mt-1' : 'mt-1.5'} flex w-full flex-1 flex-col`}>
          {/* Side tag sits on the plate's top-right corner, leaving the name the full width. */}
          {slot.tag && (
            <span className="absolute -top-[0.95rem] right-0.5 z-10 rounded bg-[#16181d] px-1 font-display text-[0.62rem] font-bold leading-[1.15rem] text-white shadow sm:text-[0.7rem]">
              {slot.tag}
            </span>
          )}
          <span className="flex w-full flex-1 flex-col overflow-hidden rounded-md text-center shadow">
            {/* Full name always: it wraps rather than being cut off. */}
            <span
              className={`flex flex-1 items-center justify-center bg-white px-0.5 pb-0.5 text-[0.68rem] font-semibold leading-tight text-[#14181f] [overflow-wrap:break-word] sm:text-xs ${slot.tag ? (compact ? 'pt-1.5 sm:pt-2' : 'pt-2') : 'pt-0.5'}`}
            >
              <span className="max-w-full [font-stretch:85%]">
                {/* Keep "J." with the surname when the plate wraps. */}
                {slot.name.replace(/^(\S+\.) /, '$1\u00a0')}
              </span>
            </span>
            {slot.sub !== undefined && (
              <span
                className={`block px-1 ${compact ? 'py-px sm:py-0.5' : 'py-0.5'} font-display text-[0.7rem] font-bold leading-tight text-white sm:text-xs ${slot.subMuted ? 'bg-[#5b6270]' : 'bg-[#d91414]'}`}
              >
                {slot.sub}
              </span>
            )}
          </span>
        </span>
      ) : (
        <span className="mt-0.5 rounded-md bg-black/30 px-1.5 py-0.5 font-display text-[0.7rem] font-bold uppercase text-white">
          {slot.label ?? slot.position}
        </span>
      )}
    </>
  );
  // Plates share the row's width (wider with 3 in a row, narrower with 5).
  const cls = `flex min-w-0 max-w-[6.5rem] flex-1 basis-0 flex-col items-center rounded-lg sm:max-w-[7rem] ${slot.highlight ? 'ring-2 ring-[#ffd400] ring-offset-2 ring-offset-transparent' : ''} ${slot.faded ? 'opacity-50' : ''}`;
  return slot.onClick ? (
    <button type="button" onClick={slot.onClick} aria-label={label} className={cls}>
      {inner}
    </button>
  ) : (
    <div aria-label={label} className={cls}>
      {inner}
    </div>
  );
}

/**
 * Players on the pitch: keeper at the top by the goal, forwards nearest you.
 * Sponsor boards (components/SponsorBoards.tsx) are parked for now; to bring
 * them back, render them above and below PitchField.
 */
export function Pitch({
  rows,
  bench,
  fit = false,
  compact = false,
}: {
  rows: Record<Position, PitchSlot[]>;
  /** Phones: sized to the screen (smaller shirts) so the whole team is in view. */
  compact?: boolean;
  /** Fill the parent's height instead of keeping a real pitch's shape (the social image). */
  fit?: boolean;
  /** Subs in order (sub keeper first), shown in a strip under the pitch. */
  bench?: PitchSlot[];
}) {
  // As FPL: keeper by the goal at the top, forwards furthest up the pitch.
  const order: Position[] = ['GK', 'DEF', 'MID', 'FWD'];
  return (
    <div
      className={
        fit
          ? 'h-full w-full overflow-hidden bg-[#1b6e41]'
          : 'mx-auto w-full max-w-[26rem] overflow-hidden rounded-2xl bg-[#1b6e41] shadow-card'
      }
    >
      <PitchField rows={rows} order={order} fit={fit} compact={compact} hasBench={Boolean(bench)} />
      {bench && (
        <div
          className={`bg-[#cfe6d6] px-1 ${compact ? 'pb-1.5 pt-1 sm:pb-3 sm:pt-2' : 'pb-3 pt-2'}`}
          aria-label="Subs"
        >
          <div className="flex justify-center gap-0.5 sm:gap-2">
            {/* Each sub's position above them, as in FPL; blank over an empty outfield slot. */}
            {bench.map((slot) => (
              <PlayerSpot
                key={slot.key}
                compact={compact}
                slot={{
                  ...slot,
                  heading:
                    slot.heading ?? (slot.name || slot.position === 'GK' ? slot.position : ''),
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Compact (phones): the field takes the screen's height less everything
// around it on Pick and Transfers (headers, page bar, save bar, tabs, subs),
// with a floor so short screens scroll rather than squash. Laptops keep a real
// pitch's shape.
const COMPACT_FIELD = {
  withBench:
    'h-[max(18.5rem,calc(100dvh-24rem-env(safe-area-inset-bottom)))] sm:h-auto sm:aspect-[590/954]',
  noBench:
    'h-[max(22rem,calc(100dvh-19rem-env(safe-area-inset-bottom)))] sm:h-auto sm:aspect-[590/954]',
};

function PitchField({
  rows,
  order,
  fit = false,
  compact = false,
  hasBench = false,
}: {
  rows: Record<Position, PitchSlot[]>;
  order: Position[];
  fit?: boolean;
  compact?: boolean;
  hasBench?: boolean;
}) {
  return (
    <div
      className={`relative w-full overflow-hidden ${compact ? COMPACT_FIELD[hasBench ? 'withBench' : 'noBench'] : ''}`}
      style={fit ? { height: '100%' } : compact ? undefined : { aspectRatio: '590 / 954' }}
    >
      <PitchMarkings stretch />
      <Boards />
      <div
        className={`relative flex h-full flex-col justify-around px-1 ${fit ? 'py-3' : compact ? 'py-1.5 sm:py-6' : 'py-6'}`}
      >
        {order.map((pos) => (
          <div key={pos} className="flex justify-center gap-0.5 sm:gap-2">
            {rows[pos].map((slot) => (
              <PlayerSpot key={slot.key} slot={slot} compact={compact} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
