import { CaptainBadge, PosBadge } from '@/components/ui';
import type { Player, Side, SquadRow } from '@/lib/queries';
import { POSITIONS } from '@/lib/scoring';

/** A saved squad, goalkeeper first, optionally with points per player. */
export function SquadList({
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
  const sorted = rows
    .map((r) => ({ row: r, player: byId.get(r.player_id) }))
    .filter((x): x is { row: SquadRow; player: Player } => Boolean(x.player))
    .sort((a, b) => POSITIONS.indexOf(a.player.position) - POSITIONS.indexOf(b.player.position));
  const total = rows.reduce((sum, r) => sum + r.points, 0);

  return (
    <table className="table">
      <tbody>
        {sorted.map(({ row, player }) => (
          <tr key={row.player_id}>
            <td>
              <PosBadge position={player.position} /> {player.name}
              {row.is_captain && <CaptainBadge />}
            </td>
            <td className="muted">{sideShort.get(player.side_id)}</td>
            {showPoints && <td className="num">{row.points}</td>}
          </tr>
        ))}
      </tbody>
      {showPoints && (
        <tfoot>
          <tr>
            <th colSpan={2}>Total</th>
            <th className="num">{total}</th>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
