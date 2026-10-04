import { Shirt } from '@/components/Pitch';
import { Sheet } from '@/components/Sheet';
import { FormBoxes, Loading, PosBadge, PriceTrend } from '@/components/ui';
import { formatShortDate, formatWeekdayTime, gameweekLabel } from '@/lib/format';
import type { ReactNode } from 'react';
import { fixtureLabel, formByPlayer } from '@/lib/form';
import {
  lockedGameweeks,
  nextOpenGameweek,
  useFixtures,
  useGameweeks,
  usePlayerHistory,
  usePlayers,
  usePriceTrend,
  useSides,
  type PlayerMatch,
} from '@/lib/queries';
import { breakdown, POSITION_NAMES, type Position } from '@/lib/scoring';
import { formatPrice } from '@/lib/squad';

function lines(m: PlayerMatch, position: Position) {
  return breakdown({
    position,
    goals: m.goals,
    assists: m.assists,
    green_cards: m.green_cards,
    yellow_cards: m.yellow_cards,
    red_cards: m.red_cards,
    player_of_match: m.player_of_match,
    goals_for: m.fixture?.goals_for ?? null,
    goals_against: m.fixture?.goals_against ?? null,
  });
}

const total = (items: [string, number][]) => items.reduce((sum, [, p]) => sum + p, 0);

export interface TeamPoints {
  points: number;
  /** e.g. "captain x2", "Team Bus x2". */
  reasons: string[];
}

/**
 * A player's card, as on the Premier League app: how they scored in a
 * gameweek, item by item, and their match-by-match history.
 */
export function PlayerDetail({
  playerId,
  gameweekId,
  teamPoints,
  actions,
}: {
  playerId: number;
  /** Show this gameweek's breakdown first. */
  gameweekId?: number;
  /** Buttons (captain, transfer...) shown under the stats. */
  actions?: ReactNode;
  /** What they scored for a fantasy team that week, if boosted (captain, chips). */
  teamPoints?: TeamPoints;
}) {
  const players = usePlayers();
  const sides = useSides();
  const gameweeks = useGameweeks();
  const trend = usePriceTrend();
  const history = usePlayerHistory(playerId);
  const fixtures = useFixtures();
  const player = players.data?.find((p) => p.id === playerId);
  if (!player || history.isLoading) return <Loading />;

  const all = gameweeks.data ?? [];
  const sideName = (id: number) => sides.data?.find((s) => s.id === id)?.name ?? '';
  const sideShort = (id: number) => sides.data?.find((s) => s.id === id)?.short_name ?? '';
  const matches = history.data ?? [];
  const season = matches.reduce((sum, m) => sum + total(lines(m, player.position)), 0);
  const thisWeek = gameweekId ? matches.filter((m) => m.fixture?.gameweek_id === gameweekId) : [];
  const gw = all.find((g) => g.id === gameweekId);

  // Points per gameweek for the history strip.
  const byWeek = new Map<number, number>();
  for (const m of matches) {
    const id = m.fixture?.gameweek_id;
    if (id) byWeek.set(id, (byWeek.get(id) ?? 0) + total(lines(m, player.position)));
  }
  const weeks = all.filter((g) => byWeek.has(g.id));
  const best = Math.max(1, ...byWeek.values());
  const form = formByPlayer(
    [...byWeek].map(([gameweek_id, points]) => ({ player_id: player.id, gameweek_id, points })),
    lockedGameweeks(all).map((g) => g.id),
  ).get(player.id);
  // The last 5 gameweeks with results: the player's own result (for
  // whichever side they played), or a gap when they didn't play.
  const resultWeeks = lockedGameweeks(all)
    .filter((g) =>
      (fixtures.data ?? []).some(
        (f) => f.gameweek_id === g.id && f.goals_for !== null && f.goals_against !== null,
      ),
    )
    .slice(-5);
  const recent = resultWeeks.map((g) => {
    const m = [...matches]
      .reverse()
      .find(
        (x) =>
          x.fixture?.gameweek_id === g.id &&
          x.fixture.goals_for !== null &&
          x.fixture.goals_against !== null,
      );
    const label = gameweekLabel(g, all).split(' ')[0];
    if (!m) return { result: null, side: '', name: `${label} didn't play` };
    const f = m.fixture!;
    const result: 'W' | 'D' | 'L' =
      f.goals_for! > f.goals_against! ? 'W' : f.goals_for! < f.goals_against! ? 'L' : 'D';
    return {
      result,
      side: sideShort(f.side_id),
      name: `${label} ${sideShort(f.side_id)} ${result === 'W' ? 'won' : result === 'L' ? 'lost' : 'drew'}`,
    };
  });
  const next = nextOpenGameweek(all);
  const nextLabel = next ? fixtureLabel(fixtures.data ?? [], player.side_id, next.id) : null;
  const nextFixture = next
    ? (fixtures.data ?? []).find((f) => f.side_id === player.side_id && f.gameweek_id === next.id)
    : undefined;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Shirt keeper={player.position === 'GK'} className="h-14 w-14 shrink-0" />
        <p className="flex items-center gap-2 text-sm">
          <PosBadge position={player.position} /> {POSITION_NAMES[player.position]} ·{' '}
          {sideName(player.side_id)}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-1 rounded-2xl bg-paper px-1 py-2.5 text-center">
        <div>
          <span className="display-num block text-2xl">
            {formatPrice(player.price)}m
            <PriceTrend change={trend.data?.get(player.id)} />
          </span>
          <span className="muted text-[0.7rem] uppercase">Price</span>
        </div>
        <div>
          <span className="display-num block text-2xl">{season}</span>
          <span className="muted text-[0.7rem] uppercase">Season</span>
        </div>
        <div>
          <span className="display-num block text-2xl">{form?.toFixed(1) ?? '-'}</span>
          <span className="muted text-[0.7rem] uppercase">Form</span>
        </div>
        <div>
          <span className="display-num block text-2xl">{matches.length}</span>
          <span className="muted text-[0.7rem] uppercase">Games</span>
        </div>
      </div>

      {nextLabel && (
        <p className="flex items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-sm">
          <span className="font-display text-xs font-bold uppercase tracking-wider text-ink-soft">
            Next
          </span>
          <span className="font-semibold">
            {nextLabel === 'No game'
              ? `No ${sideShort(player.side_id)} game this gameweek`
              : `${sideShort(player.side_id)} v ${nextLabel}`}
          </span>
          {nextFixture && (
            <span className="muted ml-auto">{formatWeekdayTime(nextFixture.kickoff)}</span>
          )}
        </p>
      )}

      <div className="flex items-start gap-2 px-1 text-sm">
        <span className="pt-0.5 font-display text-xs font-bold uppercase tracking-wider text-ink-soft">
          Last {recent.length || ''} weeks
        </span>
        {recent.length ? (
          <ul className="flex gap-1" aria-label={recent.map((r) => r.name).join(', ')}>
            {recent.map((r, i) => (
              <li key={i} aria-hidden="true" className="flex flex-col items-center">
                {r.result ? (
                  <FormBoxes results={[r.result]} />
                ) : (
                  <span className="flex h-5 w-5 items-center justify-center rounded border border-line bg-surface font-display text-xs font-bold text-ink-soft">
                    -
                  </span>
                )}
                <span
                  className={`font-display text-[0.65rem] font-bold ${r.side === sideShort(player.side_id) ? 'text-ink-soft' : 'text-brand'}`}
                >
                  {r.side || '\u00a0'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="muted">No results yet</span>
        )}
      </div>

      {actions}

      {gw && (
        <section>
          <h3 className="mb-2 font-display text-lg font-bold uppercase">
            {gameweekLabel(gw, all)}
          </h3>
          {thisWeek.length ? (
            thisWeek.map((m) => {
              const items = lines(m, player.position);
              return (
                <div key={m.fixture_id} className="mb-3 space-y-2">
                  <p className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="muted">
                      {sideShort(m.fixture?.side_id ?? 0)} {m.fixture?.is_home ? 'v' : 'at'}{' '}
                      {m.fixture?.opponent}
                      {m.fixture?.goals_for != null && m.fixture?.goals_against != null && (
                        <>
                          ,{' '}
                          {m.fixture.goals_for > m.fixture.goals_against
                            ? 'won'
                            : m.fixture.goals_for < m.fixture.goals_against
                              ? 'lost'
                              : 'drew'}{' '}
                          {m.fixture.goals_for}-{m.fixture.goals_against}
                        </>
                      )}
                    </span>
                    <span className="display-num shrink-0 text-xl text-brand">
                      {total(items)} pts
                    </span>
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {items.map(([label, pts]) => (
                      <li
                        key={label}
                        className={`rounded-full px-2.5 py-1 text-sm font-semibold ${pts < 0 ? 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300' : 'bg-paper'}`}
                      >
                        {label} {pts > 0 ? `+${pts}` : pts}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          ) : (
            <p className="muted text-sm">Didn&apos;t play this gameweek.</p>
          )}
          {teamPoints && teamPoints.reasons.length > 0 && thisWeek.length > 0 && (
            <p className="text-sm font-semibold">
              For this team: {teamPoints.points} pts ({teamPoints.reasons.join(', ')})
            </p>
          )}
        </section>
      )}

      {weeks.length > 0 && (
        <section>
          <h3 className="mb-2 font-display text-lg font-bold uppercase">Points by gameweek</h3>
          <div
            className="flex items-end gap-1.5 overflow-x-auto pb-1"
            role="img"
            aria-label="Points by gameweek"
          >
            {weeks.map((g) => {
              const pts = byWeek.get(g.id) ?? 0;
              return (
                <div key={g.id} className="flex w-10 shrink-0 flex-col items-center gap-1">
                  <span className="text-xs font-bold tabular-nums">{pts}</span>
                  <span
                    className={`w-7 rounded-t ${g.id === gameweekId ? 'bg-brand' : 'bg-brand/40'}`}
                    style={{ height: `${Math.max(4, (Math.max(pts, 0) / best) * 72)}px` }}
                  />
                  <span className="muted text-[0.65rem]">
                    {gameweekLabel(g, all).split(' ')[0]}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 font-display text-lg font-bold uppercase">Match history</h3>
        {matches.length ? (
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Date</th>
                <th>Match</th>
                <th className="num">G</th>
                <th className="num">A</th>
                <th>Cards</th>
                <th className="num">Pts</th>
              </tr>
            </thead>
            <tbody>
              {[...matches].reverse().map((m) => {
                const f = m.fixture;
                const cards = [
                  ...Array<string>(m.green_cards).fill('G'),
                  ...Array<string>(m.yellow_cards).fill('Y'),
                  ...Array<string>(m.red_cards).fill('R'),
                ].join(' ');
                return (
                  <tr key={m.fixture_id}>
                    <td className="whitespace-nowrap">
                      {f ? formatShortDate(f.kickoff.slice(0, 10)) : ''}
                    </td>
                    <td>
                      {sideShort(f?.side_id ?? 0)} {f?.is_home ? 'v' : '@'} {f?.opponent}{' '}
                      <span className="muted whitespace-nowrap">
                        {f?.goals_for ?? ''}-{f?.goals_against ?? ''}
                      </span>
                      {m.player_of_match && (
                        <span className="ml-1 text-xs font-bold text-brand">★ PoM</span>
                      )}
                    </td>
                    <td className="num">{m.goals || ''}</td>
                    <td className="num">{m.assists || ''}</td>
                    <td className="text-xs">{cards}</td>
                    <td className="num font-bold">{total(lines(m, player.position))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="muted text-sm">No matches yet this season.</p>
        )}
      </section>
    </div>
  );
}

/** PlayerDetail in a bottom sheet. */
export function PlayerSheet({
  playerId,
  gameweekId,
  teamPoints,
  onClose,
}: {
  playerId: number;
  gameweekId?: number;
  teamPoints?: TeamPoints;
  onClose: () => void;
}) {
  const players = usePlayers();
  const name = players.data?.find((p) => p.id === playerId)?.name ?? 'Player';
  return (
    <Sheet title={name} onClose={onClose}>
      <PlayerDetail playerId={playerId} gameweekId={gameweekId} teamPoints={teamPoints} />
    </Sheet>
  );
}
