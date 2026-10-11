import { useMemo } from 'react';
import { formationOf, pitchRows } from '@/lib/formation';
import { pendingLabel } from '@/lib/home';
import { cardNames } from '@/lib/pickDisplay';
import {
  useFixtures,
  useFixturesWithStats,
  useGameweekSides,
  type Player,
  type Side,
  type SquadRow,
} from '@/lib/queries';
import { POSITIONS, type Position } from '@/lib/scoring';
import type { Badge } from './TeamPitch';

/**
 * A saved squad's points as V3 badges: the 11 who count on the pitch (after
 * auto-subs), the rest on the bench. A player shows their usual side's
 * fixture until that match has synced, then their points.
 */
export function useSquadBadges(
  rows: SquadRow[] | undefined,
  players: Player[],
  sides: Side[],
  gameweekId: number | undefined,
  onOpen?: (playerId: number) => void,
) {
  const fixtures = useFixtures();
  const played = useGameweekSides(gameweekId);
  const withStats = useFixturesWithStats(gameweekId);
  return useMemo(() => {
    const byId = new Map(players.map((p) => [p.id, p]));
    const sideShort = new Map(sides.map((s) => [s.id, s.short_name]));
    const list = (rows ?? [])
      .map((r) => {
        const p = byId.get(r.player_id);
        return p ? { ...r, player: p, position: p.position } : null;
      })
      .filter((x): x is SquadRow & { player: Player; position: Position } => x !== null);
    const names = cardNames(list.map((r) => ({ id: r.player_id, name: r.player.name })));
    const badge = (r: (typeof list)[number]): Badge => {
      const pending = pendingLabel(fixtures.data ?? [], r.player.side_id, gameweekId ?? 0, {
        appeared: played.data?.has(r.player_id) ?? false,
        fixturesWithStats: withStats.data ?? new Set<number>(),
      });
      const sideIds = played.data?.get(r.player_id) ?? [r.player.side_id];
      return {
        key: `p${r.player_id}`,
        position: r.position,
        name: names.get(r.player_id) ?? r.player.name,
        data: pending ?? String(r.points),
        tone: pending ? 'muted' : 'points',
        side: sideIds.map((id) => sideShort.get(id)).join('/'),
        mark: r.is_captain ? 'C' : r.is_vice ? 'V' : undefined,
        dim: r.sub === 'off',
        onClick: onOpen ? () => onOpen(r.player_id) : undefined,
      };
    };
    const onPitch = (r: SquadRow) => r.counts && (r.bench_order === null || r.sub === 'on');
    const starters = list.filter(onPitch);
    const bench = list
      .filter((r) => !onPitch(r))
      .sort(
        (a, b) =>
          Number(b.position === 'GK') - Number(a.position === 'GK') ||
          (a.bench_order ?? 9) - (b.bench_order ?? 9),
      );
    const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 } as Record<Position, number>;
    for (const r of starters) counts[r.position] += 1;
    const laid = pitchRows(starters, formationOf(counts));
    const pitch = Object.fromEntries(
      POSITIONS.map((pos) => [pos, laid[pos].flatMap((r) => (r ? [badge(r)] : []))]),
    ) as Record<Position, Badge[]>;
    // Who has scored, best first, for "Just synced".
    const scored = list
      .filter((r) => onPitch(r))
      .map((r) => ({ r, b: badge(r) }))
      .filter(({ b, r }) => b.tone === 'points' && r.points > 0)
      .sort((a, b) => b.r.points - a.r.points)
      .map(({ r, b }) => ({
        id: r.player_id,
        side: b.side ?? '',
        name: r.player.name,
        captain: r.is_captain,
        points: r.points,
      }));
    return { pitch, bench: bench.map(badge), scored };
  }, [rows, players, sides, gameweekId, fixtures.data, played.data, withStats.data, onOpen]);
}
