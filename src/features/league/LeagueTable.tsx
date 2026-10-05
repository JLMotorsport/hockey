import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth/AuthProvider';
import { gameweekLabel } from '@/lib/format';
import { lockedGameweeks, useGameweeks, useLeagueTable } from '@/lib/queries';
import { ErrorText, Loading } from '@/components/ui';
import { leagueRows, movement } from '@/lib/table';

export function LeagueTable({
  limit,
  include,
}: {
  limit?: number;
  /** A mini league: who's in it (ranked again from 1). */
  include?: (userId: string) => boolean;
}) {
  const { session } = useAuth();
  const table = useLeagueTable();
  const gameweeks = useGameweeks();
  if (table.isLoading || gameweeks.isLoading) return <Loading />;
  if (table.error) return <ErrorText error={table.error} />;
  const all = include ? leagueRows(table.data ?? [], include) : (table.data ?? []);
  const rows = all.slice(0, limit);
  if (!rows.length)
    return (
      <p className="muted">
        {include ? 'Nobody in this league yet.' : 'No teams yet. Be the first.'}
      </p>
    );
  const locked = lockedGameweeks(gameweeks.data ?? []);
  const latest = locked.at(-1);
  // Movement only means something once there's a gameweek before this one.
  const moved = locked.length > 1 ? movement(all) : new Map<string, number>();

  return (
    <div>
      <div className="grid grid-cols-[2.75rem_1fr_3rem_3.5rem] items-center border-b border-line px-1 pb-2 font-display text-xs font-bold uppercase tracking-wide text-ink-soft">
        <span>Pos</span>
        <span>Team</span>
        <span className="text-right">
          {latest ? gameweekLabel(latest, gameweeks.data ?? []).split(' ')[0] : 'GW'}
        </span>
        <span className="text-right">Total</span>
      </div>
      <ol>
        {rows.map((row) => {
          const move = moved.get(row.user_id) ?? 0;
          return (
            <li key={row.user_id}>
              <Link
                to={`/teams/${row.user_id}`}
                className={`grid min-h-[60px] grid-cols-[2.75rem_1fr_3rem_3.5rem] items-center border-b border-line px-1 text-ink no-underline hover:no-underline ${row.user_id === session?.user.id ? 'bg-brand/10' : ''}`}
              >
                <span className="flex items-center gap-1">
                  <span className="display-num text-xl">{row.rank}</span>
                  {move !== 0 && (
                    <span
                      className={`text-[0.7rem] font-bold ${move > 0 ? 'text-[#1f7a4d] dark:text-[#5fd39a]' : 'text-[#b3261e] dark:text-[#ff8a80]'}`}
                      aria-label={move > 0 ? `up ${move}` : `down ${-move}`}
                    >
                      {move > 0 ? `▲${move}` : `▼${-move}`}
                    </span>
                  )}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-bold">{row.team_name}</span>
                  <span className="muted truncate text-sm">{row.display_name}</span>
                </span>
                <span className="text-right tabular-nums text-ink-soft">{row.latest}</span>
                <span className="display-num text-right text-2xl">{row.total}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
