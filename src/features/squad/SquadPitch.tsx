import { useState } from 'react';
import { Pitch, type PitchSlot } from '@/components/Pitch';
import { formationOf, pitchRows } from '@/lib/formation';
import type { Player, Side, SquadRow } from '@/lib/queries';
import { POSITIONS, type Position } from '@/lib/scoring';
import { shortName } from '@/lib/format';
import { PlayerSheet, type TeamPoints } from '@/features/player/PlayerDetail';
import { chipName, type PlayedChip } from '@/lib/chips';

/** A saved squad on the pitch, with points (or side) under each player. */
export function SquadPitch({
  rows,
  players,
  sides,
  showPoints,
  seasonPoints,
  gameweekId,
  chip,
}: {
  rows: SquadRow[];
  players: Player[];
  sides: Side[];
  /** True: points in this gameweek. False: points so far this season. */
  showPoints: boolean;
  seasonPoints?: Map<number, number>;
  /** Tapping a player shows how they scored in this gameweek. */
  gameweekId?: number;
  /** A chip played this gameweek. */
  chip?: PlayedChip;
}) {
  const [open, setOpen] = useState<{ id: number; teamPoints: TeamPoints } | null>(null);
  const byId = new Map(players.map((p) => [p.id, p]));
  const sideShort = new Map(sides.map((s) => [s.id, s.short_name]));
  const withPlayer = rows
    .map((r) => {
      const p = byId.get(r.player_id);
      return p ? { ...r, player: p, position: p.position } : null;
    })
    .filter((x): x is SquadRow & { player: Player; position: Position } => x !== null);
  // The 11 who count (after any auto-subs) on the pitch, everyone else on the
  // bench (with Rolling Subs the bench counts too, but stays on the bench).
  const onPitch = (r: SquadRow) => r.counts && (r.bench_order === null || r.sub === 'on');
  const picked = withPlayer.filter(onPitch);
  const benched = withPlayer
    .filter((r) => !onPitch(r))
    .sort(
      (a, b) =>
        Number(b.position === 'GK') - Number(a.position === 'GK') ||
        (a.bench_order ?? 9) - (b.bench_order ?? 9),
    );
  const pts = (r: SquadRow) =>
    showPoints ? `${r.points} pts` : `${seasonPoints?.get(r.player_id) ?? 0} pts`;
  const slotFor = (r: (typeof withPlayer)[number]): PitchSlot => ({
    key: `p${r.player_id}`,
    position: r.position,
    name: shortName(r.player.name),
    tag: sideShort.get(r.player.side_id),
    sub: r.sub === 'on' ? `On · ${pts(r)}` : r.sub === 'off' ? `Off · ${pts(r)}` : pts(r),
    captain: r.is_captain,
    badge: r.is_vice
      ? 'V'
      : !r.counts && r.bench_order && r.bench_order > 1
        ? String(r.bench_order - 1)
        : undefined,
    faded: r.sub === 'off',
    onClick: () =>
      setOpen({
        id: r.player_id,
        teamPoints: {
          points: r.points,
          reasons: [
            ...(r.doubled
              ? [chip?.chip === 'triple_captain' ? 'triple captain x3' : 'captain x2']
              : []),
            ...(r.bus_points > 0 ? ['Team Bus x2'] : []),
            ...(chip?.chip === 'rolling_subs' && r.bench_order !== null && r.sub === null
              ? ['Rolling Subs']
              : []),
          ],
        },
      }),
  });
  const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 } as Record<Position, number>;
  for (const r of picked) counts[r.position] += 1;
  const laid = pitchRows(picked, formationOf(counts));
  const slots = Object.fromEntries(
    POSITIONS.map((pos) => [
      pos,
      laid[pos].map((r, i): PitchSlot =>
        r ? slotFor(r) : { key: `${pos}${i}`, position: pos, name: null },
      ),
    ]),
  ) as Record<Position, PitchSlot[]>;
  const sideName = sides.find((x) => x.id === chip?.side_id)?.name;
  return (
    <>
      {chip && (
        <p className="mx-auto mb-2 w-full max-w-[26rem] rounded-xl bg-[#16181d] px-3 py-2 text-center font-display text-sm font-bold uppercase tracking-wide text-white">
          {chipName(chip.chip)} played{sideName ? `: ${sideName}` : ''}
        </p>
      )}
      <Pitch rows={slots} bench={benched.length ? benched.map(slotFor) : undefined} />
      {open && (
        <PlayerSheet
          playerId={open.id}
          gameweekId={showPoints ? gameweekId : undefined}
          teamPoints={open.teamPoints}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
