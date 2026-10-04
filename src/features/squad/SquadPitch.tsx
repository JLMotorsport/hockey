import { Pitch, type PitchSlot } from '@/components/Pitch';
import { formationOf, pitchRows } from '@/lib/formation';
import type { Player, Side, SquadRow } from '@/lib/queries';
import { POSITIONS, type Position } from '@/lib/scoring';
import { shortName } from '@/lib/format';

/** A saved squad on the pitch, with points (or side) under each player. */
export function SquadPitch({
  rows,
  players,
  sides,
  showPoints,
}: {
  rows: SquadRow[];
  players: Player[];
  sides: Side[];
  showPoints: boolean;
}) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const sideShort = new Map(sides.map((s) => [s.id, s.short_name]));
  const picked = rows
    .map((r) => {
      const p = byId.get(r.player_id);
      return p ? { ...r, player: p, position: p.position } : null;
    })
    .filter((x): x is SquadRow & { player: Player; position: Position } => x !== null);
  const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 } as Record<Position, number>;
  for (const r of picked) counts[r.position] += 1;
  const laid = pitchRows(picked, formationOf(counts));
  const slots = Object.fromEntries(
    POSITIONS.map((pos) => [
      pos,
      laid[pos].map((r, i): PitchSlot =>
        r
          ? {
              key: `p${r.player_id}`,
              position: pos,
              name: shortName(r.player.name),
              sub: showPoints ? `${r.points}` : sideShort.get(r.player.side_id),
              captain: r.is_captain,
            }
          : { key: `${pos}${i}`, position: pos, name: null },
      ),
    ]),
  ) as Record<Position, PitchSlot[]>;
  return <Pitch rows={slots} />;
}
