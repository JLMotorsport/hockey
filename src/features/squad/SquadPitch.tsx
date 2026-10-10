import { useState } from 'react';
import { Pitch, type PitchSlot } from '@/components/Pitch';
import { formationOf, pitchRows } from '@/lib/formation';
import {
  useFixtures,
  useGameweekSides,
  type Player,
  type Side,
  type SquadRow,
} from '@/lib/queries';
import { fixtureLabel } from '@/lib/form';
import { POSITIONS, type Position } from '@/lib/scoring';
import { shortName } from '@/lib/format';
import { PlayerSheet, type TeamPoints } from '@/features/player/PlayerDetail';
import { chipName, type PlayedChip } from '@/lib/chips';
import { pendingLabel } from '@/lib/home';
import { cardNames } from '@/lib/pickDisplay';

/** A saved squad on the pitch, with points (or side) under each player. */
export function SquadPitch({
  rows,
  players,
  sides,
  showPoints,
  seasonPoints,
  gameweekId,
  chip,
  fixturesFor,
  compact = false,
  card = false,
  fieldClass,
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
  /** An upcoming gameweek: show who each player's side plays in it instead of points. */
  fixturesFor?: number;
  /** Phones: sized to the screen so the whole team is in view. */
  compact?: boolean;
  /**
   * FPL's points cards (Home): surname and points, a dash until their game's
   * result is in, and the subs as one line under the pitch.
   */
  card?: boolean;
  fieldClass?: string;
}) {
  const fixtures = useFixtures();
  // For a past gameweek, tag each player with the side they actually played for.
  const played = useGameweekSides(showPoints ? gameweekId : undefined);
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
  const nextLabel = (r: SquadRow & { player: Player }) =>
    fixtureLabel(fixtures.data ?? [], r.player.side_id, fixturesFor ?? 0);
  const pts = (r: SquadRow & { player: Player }) =>
    fixturesFor
      ? nextLabel(r)
      : showPoints
        ? `${r.points} pts`
        : `${seasonPoints?.get(r.player_id) ?? 0} pts`;
  const names = cardNames(withPlayer.map((r) => ({ id: r.player_id, name: r.player.name })));
  // Until their usual side's result is in: who that side plays, not 0 points.
  const pending = (r: (typeof withPlayer)[number]) =>
    pendingLabel(
      fixtures.data ?? [],
      r.player.side_id,
      gameweekId ?? 0,
      played.data?.has(r.player_id) ?? false,
    );
  const cardSlot = (r: (typeof withPlayer)[number]): PitchSlot => ({
    key: `p${r.player_id}`,
    position: r.position,
    name: names.get(r.player_id) ?? shortName(r.player.name),
    sub: pending(r) ?? String(r.points),
    subMuted: pending(r) !== null,
    subDark: true,
    captain: r.is_captain,
    badge: r.is_vice ? 'V' : undefined,
    faded: r.sub === 'off',
    onClick: () => setOpen({ id: r.player_id, teamPoints: { points: r.points, reasons: [] } }),
  });
  const slotFor = (r: (typeof withPlayer)[number]): PitchSlot => ({
    key: `p${r.player_id}`,
    position: r.position,
    name: shortName(r.player.name),
    tag: (played.data?.get(r.player_id) ?? [r.player.side_id])
      .map((id) => sideShort.get(id))
      .join('/'),
    sub: r.sub === 'on' ? `On · ${pts(r)}` : r.sub === 'off' ? `Off · ${pts(r)}` : pts(r),
    captain: r.is_captain,
    badge: r.is_vice
      ? 'V'
      : !r.counts && r.bench_order && r.bench_order > 1
        ? String(r.bench_order - 1)
        : undefined,
    faded: r.sub === 'off',
    subMuted: Boolean(fixturesFor) && nextLabel(r) === 'No game',
    onClick: () =>
      setOpen({
        id: r.player_id,
        teamPoints: {
          points: r.points,
          reasons: [
            ...(r.doubled
              ? [chip?.chip === 'triple_captain' ? 'triple captain x3' : 'captain x2']
              : []),
            ...(r.bus_points !== 0 ? ['Team Bus x2'] : []),
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
        r ? (card ? cardSlot(r) : slotFor(r)) : { key: `${pos}${i}`, position: pos, name: null },
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
      <Pitch
        rows={slots}
        bench={!card && benched.length ? benched.map(slotFor) : undefined}
        compact={compact}
        variant={card ? 'card' : 'plate'}
        fieldClass={fieldClass}
      />
      {card && benched.length > 0 && (
        <p className="mb-0 mt-1.5 text-center text-xs opacity-85">
          Subs:{' '}
          {benched
            .map((r) => `${names.get(r.player_id) ?? r.player.name} ${pending(r) ?? r.points}`)
            .join(' · ')}
        </p>
      )}
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
