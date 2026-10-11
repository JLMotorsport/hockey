// A field hockey pitch (FIH: 91.4 m x 55 m) drawn in perspective, to scale.
// Pure geometry: everything returns SVG path strings in screen pixels, so the
// pitch stays sharp at any size. y = 0 is the far backline (your goal on team
// screens); x runs 0 to 55 across.

import type { Position } from './scoring';

export const PITCH_LENGTH = 91.4;
export const PITCH_WIDTH = 55;
const GOAL_HALF = 1.83; // goal is 3.66 m wide
const CIRCLE = 14.63; // shooting circle radius from each post
const DASHED = 19.63; // broken line 5 m outside the circle
const SPOT = 6.475; // penalty spot from the backline
const LINE_23 = 22.9;

type Pt = [number, number];

/** The circle (or its dashed line): quarter arcs on each post joined by a straight line. */
export function circleLine(radius: number, far = true, steps = 24): Pt[] {
  const sgn = far ? 1 : -1;
  const by = far ? 0 : PITCH_LENGTH;
  const lp = PITCH_WIDTH / 2 - GOAL_HALF;
  const rp = PITCH_WIDTH / 2 + GOAL_HALF;
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((180 - (90 * i) / steps) * Math.PI) / 180;
    pts.push([lp + radius * Math.cos(a), by + sgn * radius * Math.sin(a)]);
  }
  for (let i = 0; i <= steps; i++) {
    const a = ((90 - (90 * i) / steps) * Math.PI) / 180;
    pts.push([rp + radius * Math.cos(a), by + sgn * radius * Math.sin(a)]);
  }
  return pts;
}

interface Projection {
  /** Metres to screen pixels. */
  at: (x: number, y: number) => Pt;
  scale: (y: number) => number;
}

/**
 * Perspective from y0 (far, top) to y1 (near, bottom of the drawn area):
 * the far end is `depth` times further away than the near end.
 */
export function projection(o: {
  width: number;
  top: number;
  bottom: number;
  y0: number;
  y1: number;
  depth: number;
  cx?: number;
}): Projection {
  const { width, top, bottom, y0, y1, depth } = o;
  const cx = o.cx ?? width / 2;
  const d = (bottom - top) / (1 - 1 / depth);
  const yh = bottom - d;
  const scale = (y: number) => 1 / (depth + (1 - depth) * ((y - y0) / (y1 - y0)));
  return {
    scale,
    at: (x, y) => {
      const s = scale(y);
      return [cx + (x - PITCH_WIDTH / 2) * (width / PITCH_WIDTH) * s, yh + d * s];
    },
  };
}

function path(p: Projection, pts: Pt[], close = false): string {
  return (
    'M ' +
    pts
      .map(([x, y]) => p.at(x, y))
      .map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`)
      .join(' L ') +
    (close ? ' Z' : '')
  );
}

/** A polyline (metres) cut into short dashes: 0.3 m on, 3 m off, as the real broken line. */
function dashes(p: Projection, pts: Pt[], on = 0.3, off = 3): string[] {
  const out: string[] = [];
  let acc = 0;
  let drawing = true;
  let seg: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    let pos = 0;
    while (pos < len) {
      const need = (drawing ? on : off) - acc;
      const step = Math.min(need, len - pos);
      pos += step;
      acc += step;
      const pt: Pt = [x0 + ((x1 - x0) * pos) / len, y0 + ((y1 - y0) * pos) / len];
      if (drawing) seg.push(pt);
      if (acc >= (drawing ? on : off) - 1e-9) {
        if (drawing && seg.length > 1) out.push(path(p, seg));
        drawing = !drawing;
        acc = 0;
        seg = [pt];
      }
    }
  }
  return out;
}

/** The marks either side of a goal on its backline, 5 m and 10 m from each post (drawn 0.9 m to be seen). */
function backlineMarks(p: Projection, far: boolean): string[] {
  const by = far ? 0 : PITCH_LENGTH;
  const dir = far ? 1 : -1;
  const l = PITCH_WIDTH / 2 - GOAL_HALF;
  const r = PITCH_WIDTH / 2 + GOAL_HALF;
  return [l - 10, l - 5, r + 5, r + 10].map((x) =>
    path(p, [
      [x, by],
      [x, by + dir * 0.9],
    ]),
  );
}

function goal(p: Projection, far: boolean): string {
  const by = far ? 0 : PITCH_LENGTH;
  const depth = far ? -1.6 : 1.6;
  const l = PITCH_WIDTH / 2 - GOAL_HALF;
  const r = PITCH_WIDTH / 2 + GOAL_HALF;
  return path(p, [
    [l, by],
    [l, by + depth],
    [r, by + depth],
    [r, by],
  ]);
}

function spot(p: Projection, y: number) {
  const [cx, cy] = p.at(PITCH_WIDTH / 2, y);
  const s = p.scale(y);
  return { cx, cy, rx: 2.6 * s, ry: 1.5 * s };
}

export interface PitchDrawing {
  turf: string;
  /** Solid lines, drawn first (the opening animates these). */
  lines: string[];
  /** Dashes and marks, shown once the lines are down. */
  details: string[];
  goals: string[];
  spots: { cx: number; cy: number; rx: number; ry: number }[];
}

/** The whole pitch, both ends, seen from one end (the opening screen). */
export function fullPitch(o: {
  width: number;
  top: number;
  bottom: number;
  depth?: number;
  cx?: number;
}): PitchDrawing {
  const p = projection({ ...o, y0: 0, y1: PITCH_LENGTH, depth: o.depth ?? 2.4 });
  const L = PITCH_LENGTH;
  const W = PITCH_WIDTH;
  return {
    turf: path(
      p,
      [
        [0, 0],
        [W, 0],
        [W, L],
        [0, L],
      ],
      true,
    ),
    lines: [
      path(p, [
        [0, 0],
        [W, 0],
        [W, L],
        [0, L],
        [0, 0],
      ]),
      path(p, [
        [0, L / 2],
        [W, L / 2],
      ]),
      path(p, [
        [0, LINE_23],
        [W, LINE_23],
      ]),
      path(p, [
        [0, L - LINE_23],
        [W, L - LINE_23],
      ]),
      path(p, circleLine(CIRCLE, true)),
      path(p, circleLine(CIRCLE, false)),
    ],
    details: [
      ...dashes(p, circleLine(DASHED, true)),
      ...dashes(p, circleLine(DASHED, false)),
      ...backlineMarks(p, true),
      ...backlineMarks(p, false),
    ],
    goals: [goal(p, true), goal(p, false)],
    spots: [spot(p, SPOT), spot(p, L - SPOT)],
  };
}

/** Where each row stands, in metres from your own backline. */
export const ROW_Y: Record<Position, number> = {
  GK: 2,
  DEF: LINE_23,
  MID: PITCH_LENGTH / 2,
  FWD: PITCH_LENGTH - LINE_23,
};

export interface TeamPitchDrawing extends PitchDrawing {
  /** Screen y of the line each row stands on. */
  rows: Record<Position, number>;
}

/**
 * Your goal at the top through to the opposition's 23 near the bottom (team
 * screens). Keeper on the goal line, defenders on your 23, midfield on
 * halfway, forwards on their 23, which sits `labelRoom` px above the bottom.
 */
export function teamPitch(o: {
  width: number;
  height: number;
  labelRoom: number;
  pad?: number;
  depth?: number;
}): TeamPitchDrawing {
  const pad = o.pad ?? 6;
  const p = projection({
    width: o.width - 2 * pad,
    cx: o.width / 2,
    top: pad + 10,
    bottom: o.height - o.labelRoom,
    y0: 0,
    y1: ROW_Y.FWD,
    depth: o.depth ?? 1.15,
  });
  const W = PITCH_WIDTH;
  // Carry the turf on to the bottom of the box.
  let yEnd = ROW_Y.FWD;
  while (p.at(0, yEnd)[1] < o.height && yEnd < PITCH_LENGTH) yEnd += 0.25;
  const L = PITCH_LENGTH;
  return {
    turf: path(
      p,
      [
        [0, 0],
        [W, 0],
        [W, yEnd],
        [0, yEnd],
      ],
      true,
    ),
    lines: [
      path(p, [
        [0, yEnd],
        [0, 0],
        [W, 0],
        [W, yEnd],
      ]),
      path(p, [
        [0, LINE_23],
        [W, LINE_23],
      ]),
      path(p, [
        [0, L / 2],
        [W, L / 2],
      ]),
      path(p, [
        [0, L - LINE_23],
        [W, L - LINE_23],
      ]),
      path(p, circleLine(CIRCLE, true)),
    ],
    details: [...dashes(p, circleLine(DASHED, true)), ...backlineMarks(p, true)],
    goals: [goal(p, true)],
    spots: [spot(p, SPOT)],
    rows: {
      GK: p.at(W / 2, ROW_Y.GK)[1],
      DEF: p.at(W / 2, ROW_Y.DEF)[1],
      MID: p.at(W / 2, ROW_Y.MID)[1],
      FWD: p.at(W / 2, ROW_Y.FWD)[1],
    },
  };
}
