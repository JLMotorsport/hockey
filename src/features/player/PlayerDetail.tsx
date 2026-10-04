import { Shirt } from '@/components/Pitch';
import { Sheet } from '@/components/Sheet';
import { Loading, PosBadge, PriceTrend } from '@/components/ui';
import { formatShortDate, gameweekLabel } from '@/lib/format';
import {
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

/**
 * A player's card, as on the Premier League app: how they scored in a
 * gameweek, item by item, and their match-by-match history.
 */
export function PlayerDetail({
  playerId,
  gameweekId,
  captain = false,
}: {
  playerId: number;
  /** Show this gameweek's breakdown first. */
  gameweekId?: number;
  /** Their points that week were doubled. */
  captain?: boolean;
}) {
  const players = usePlayers();
  const sides = useSides();
  const gameweeks = useGameweeks();
  const trend = usePriceTrend();
  const history = usePlayerHistory(playerId);
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

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Shirt keeper={player.position === 'GK'} className="h-16 w-16 shrink-0" />
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm">
            <PosBadge position={player.position} /> {POSITION_NAMES[player.position]} ·{' '}
            {sideName(player.side_id)}
          </p>
          <div className="mt-2 flex gap-4">
            <div>
              <span className="display-num block text-2xl">
                {formatPrice(player.price)}m
                <PriceTrend change={trend.data?.get(player.id)} />
              </span>
              <span className="muted text-xs uppercase">Price</span>
            </div>
            <div>
              <span className="display-num block text-2xl">{season}</span>
              <span className="muted text-xs uppercase">Season pts</span>
            </div>
            <div>
              <span className="display-num block text-2xl">{matches.length}</span>
              <span className="muted text-xs uppercase">Games</span>
            </div>
          </div>
        </div>
      </div>

      {gw && (
        <section>
          <h3 className="mb-2 font-display text-lg font-bold uppercase">
            {gameweekLabel(gw, all)}
          </h3>
          {thisWeek.length ? (
            thisWeek.map((m) => {
              const items = lines(m, player.position);
              return (
                <div key={m.fixture_id} className="mb-3 rounded-xl border border-line">
                  <p className="border-b border-line px-3 py-2 text-sm font-semibold">
                    {sideShort(m.fixture?.side_id ?? 0)} {m.fixture?.is_home ? 'v' : '@'}{' '}
                    {m.fixture?.opponent}{' '}
                    <span className="muted font-normal">
                      {m.fixture?.goals_for ?? ''}-{m.fixture?.goals_against ?? ''}
                    </span>
                  </p>
                  <table className="table">
                    <tbody>
                      {items.map(([label, pts]) => (
                        <tr key={label}>
                          <td>{label}</td>
                          <td
                            className={`num font-semibold ${pts < 0 ? 'text-red-700 dark:text-red-400' : ''}`}
                          >
                            {pts > 0 ? `+${pts}` : pts}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th>Points</th>
                        <th className="num">{total(items)}</th>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              );
            })
          ) : (
            <p className="muted text-sm">Didn&apos;t play this gameweek.</p>
          )}
          {captain && thisWeek.length > 0 && (
            <p className="text-sm font-semibold">
              Captain: {thisWeek.reduce((sum, m) => sum + total(lines(m, player.position)), 0)} x 2
              = {thisWeek.reduce((sum, m) => sum + total(lines(m, player.position)), 0) * 2} pts
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
  captain,
  onClose,
}: {
  playerId: number;
  gameweekId?: number;
  captain?: boolean;
  onClose: () => void;
}) {
  const players = usePlayers();
  const name = players.data?.find((p) => p.id === playerId)?.name ?? 'Player';
  return (
    <Sheet title={name} onClose={onClose}>
      <PlayerDetail playerId={playerId} gameweekId={gameweekId} captain={captain} />
    </Sheet>
  );
}
