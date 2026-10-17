import { useState } from 'react';
import { Sheet } from '@/components/Sheet';
import { Loading, PosBadge } from '@/components/ui';
import { PlayerSheet } from '@/features/player/PlayerDetail';
import { formatWeekdayTime } from '@/lib/format';
import { opponentName, resultOf } from '@/lib/form';
import { useFixtureDetail, usePlayers, useSides } from '@/lib/queries';
import { breakdown, points } from '@/lib/scoring';

/**
 * One result: who played for Felixstowe and what each scored in it. Tap a
 * player for their card, with how they got their points that gameweek;
 * closing it comes back here.
 */
export function MatchSheet({ fixtureId, onClose }: { fixtureId: number; onClose: () => void }) {
  const [playerId, setPlayerId] = useState<number | null>(null);
  const detail = useFixtureDetail(fixtureId);
  const players = usePlayers();
  const sides = useSides();
  const fixture = detail.data?.fixture;

  if (playerId !== null) {
    return (
      <PlayerSheet
        playerId={playerId}
        gameweekId={fixture?.gameweek_id ?? undefined}
        onClose={() => setPlayerId(null)}
      />
    );
  }

  const side = sides.data?.find((s) => s.id === fixture?.side_id);
  const title = fixture ? `${side?.short_name ?? ''} v ${opponentName(fixture.opponent)}` : 'Match';
  const byId = new Map((players.data ?? []).map((p) => [p.id, p]));
  const rows = (detail.data?.performances ?? [])
    .map((perf) => {
      const player = byId.get(perf.player_id);
      if (!player || !fixture) return null;
      const line = {
        position: player.position,
        goals: perf.goals,
        assists: perf.assists,
        green_cards: perf.green_cards,
        yellow_cards: perf.yellow_cards,
        red_cards: perf.red_cards,
        player_of_match: perf.player_of_match,
        goals_for: fixture.goals_for,
        goals_against: fixture.goals_against,
        is_home: fixture.is_home,
      };
      // The headline things, for the line under the name ("Played" goes without saying).
      const why = breakdown(line)
        .filter(([reason]) => reason !== 'Played')
        .map(([reason]) => reason.replace('(s)', reason.startsWith('1 ') ? '' : 's'));
      return { player, points: points(line), why };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.points - a.points || a.player.name.localeCompare(b.player.name));
  const result = fixture ? resultOf(fixture) : null;

  return (
    <Sheet title={title} onClose={onClose}>
      {detail.isLoading || !fixture ? (
        <Loading />
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <span className="flex-1 text-sm">
              <span className="block font-semibold">{fixture.is_home ? 'Home' : 'Away'}</span>
              <span className="muted">{formatWeekdayTime(fixture.kickoff)}</span>
            </span>
            {result && (
              <>
                <span className="display-num text-3xl">
                  {fixture.goals_for}-{fixture.goals_against}
                </span>
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-md font-display font-bold text-white ${result === 'W' ? 'bg-[#1f7a4d]' : result === 'L' ? 'bg-[#b3261e]' : 'bg-[#6b7280]'}`}
                  aria-label={result === 'W' ? 'Won' : result === 'L' ? 'Lost' : 'Drew'}
                >
                  {result}
                </span>
              </>
            )}
          </div>
          {rows.length === 0 ? (
            <p className="muted">
              Who played isn&apos;t in yet. It appears once the match syncs from England Hockey.
            </p>
          ) : (
            <>
              <p className="mb-1 text-xs font-bold uppercase tracking-widest text-ink-soft">
                Who played · {rows.length}
              </p>
              <ul className="divide-y divide-line">
                {rows.map((r) => (
                  <li key={r.player.id}>
                    <button
                      type="button"
                      onClick={() => setPlayerId(r.player.id)}
                      className="flex min-h-[52px] w-full items-center gap-2.5 py-2 text-left"
                    >
                      <PosBadge position={r.player.position} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{r.player.name}</span>
                        {r.why.length > 0 && (
                          <span className="muted block truncate text-xs">{r.why.join(' · ')}</span>
                        )}
                      </span>
                      <span className="display-num text-xl">{r.points}</span>
                      <span className="muted text-xs">pts</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="muted mt-3 text-xs">
                Points from this match only (before captains and chips). Tap a player to see how
                they got them.
              </p>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
