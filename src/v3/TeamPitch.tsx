import { useMemo, type ReactNode } from 'react';
import { PlayerSpot, type PitchSlot } from '@/components/Pitch';
import { teamPitch } from '@/lib/hockeyPitch';
import type { Position } from '@/lib/scoring';

// V3's team view: a real hockey pitch, to scale, with each row standing on its
// line (keeper on the goal line, defenders on your 23, midfield on halfway,
// forwards on the opposition 23), in the traditional look: striped grass,
// white lines, the FHC boards, and the club kit on name plates or FPL cards.

export interface Badge {
  key: string;
  position: Position;
  name: string;
  /** The line under the name: a fixture, a price, points... */
  data: ReactNode;
  /** 'points': points are in; 'muted': waiting or no game (a grey strip). */
  tone?: 'plain' | 'points' | 'muted';
  /** The side they play for, e.g. "M3". */
  side?: string;
  /** "C", "V" or a sub number. */
  mark?: string;
  dim?: boolean;
  highlight?: boolean;
  /** An empty place: a dashed outline to tap and fill. */
  empty?: boolean;
  onClick?: () => void;
}

function toSlot(b: Badge): PitchSlot {
  return {
    key: b.key,
    position: b.position,
    name: b.empty ? null : b.name,
    label: b.empty ? b.position : undefined,
    tag: b.side,
    sub: b.empty ? undefined : b.data,
    subMuted: b.tone === 'muted',
    subDark: b.tone === 'points',
    captain: b.mark === 'C',
    badge: b.mark,
    highlight: b.highlight,
    faded: b.dim,
    onClick: b.onClick,
  };
}

// The traditional (V2) look, on the real pitch: striped grass, white lines,
// the FHC boards behind the goal, each row's shirts standing on its line.
const BOARDS_H = 24;
// From the top of a player to the middle of their shirt, which sits on the line.
const SHIRT_MID = { card: 22, plate: 16 };
// Below the forwards' line: the rest of the card or plate, and a margin.
const BELOW_LINE = 64;

export function TeamPitch({
  rows,
  height,
  bench,
  card = false,
}: {
  rows: Record<Position, Badge[]>;
  height: number;
  bench?: Badge[];
  /** FPL's player cards (Pick, Transfers) rather than name plates. */
  card?: boolean;
}) {
  const width = 366;
  const d = useMemo(
    () =>
      teamPitch({ width, height, labelRoom: BELOW_LINE, pad: 10, top: BOARDS_H + 22, depth: 1.15 }),
    [height],
  );
  const order: Position[] = ['GK', 'DEF', 'MID', 'FWD'];
  const anchor = card ? SHIRT_MID.card : SHIRT_MID.plate;
  const spot = (b: Badge, onBench = false) => (
    <PlayerSpot
      key={b.key}
      compact
      card={card}
      slot={{
        ...toSlot(b),
        fitName: true,
        faded: onBench ? false : b.dim,
        heading: onBench ? (b.empty ? '' : b.position) : undefined,
      }}
    />
  );
  return (
    <div className="relative mx-auto w-[366px] max-w-full shrink-0" style={{ height }}>
      <div
        className={`absolute inset-0 overflow-hidden bg-[#1b6e41] ${bench ? 'rounded-t-2xl' : 'rounded-2xl'}`}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="absolute inset-0"
          aria-hidden="true"
        >
          {d.bands.map((band, i) => (
            <rect
              key={i}
              y={band.y0}
              width={width}
              height={Math.max(0, band.y1 - band.y0)}
              fill={i % 2 ? '#239552' : '#1b7a43'}
            />
          ))}
          <g
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity=".9"
          >
            {[...d.lines, ...d.details].map((p, i) => (
              <path key={i} d={p} />
            ))}
            {d.goals.map((g, i) => (
              <path key={`g${i}`} d={g} fill="rgb(255 255 255 / .25)" />
            ))}
          </g>
          {d.spots.map((s, i) => (
            <ellipse key={`s${i}`} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill="#fff" />
          ))}
        </svg>
        <div
          className="absolute inset-x-[4%] top-0 flex items-center justify-between rounded-b-md bg-[linear-gradient(90deg,#d91414,#a50f0f)] px-[3%] font-display text-[0.6rem] font-extrabold uppercase tracking-[0.2em] text-white/90"
          style={{ height: BOARDS_H }}
          aria-hidden="true"
        >
          <span>FHC</span>
          <span>FHC</span>
        </div>
      </div>
      {order.map((pos) => (
        <div
          key={pos}
          className={`absolute inset-x-0 flex justify-center px-1 ${card ? 'gap-1.5' : 'gap-0.5'}`}
          style={{ top: Math.round(d.rows[pos] - anchor) }}
        >
          {rows[pos].map((b) => spot(b))}
        </div>
      ))}
      {bench && (
        <div
          className={`absolute inset-x-0 top-full flex justify-center rounded-b-2xl px-1 pb-1.5 pt-1 ${card ? 'gap-1.5 bg-[#8fd1a6]' : 'gap-0.5 bg-[#cfe6d6]'}`}
          aria-label="Subs"
        >
          {bench.map((b) => spot(b, true))}
        </div>
      )}
    </div>
  );
}
