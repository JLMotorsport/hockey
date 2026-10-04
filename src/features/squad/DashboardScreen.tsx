import { useQueries } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import { ErrorText, Loading, Stat } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { formatDayTime, gameweekLabel } from '@/lib/format';
import {
  keys,
  lockedGameweeks,
  nextOpenGameweek,
  useGameweeks,
  useLeagueTable,
  usePlayers,
  useSides,
  useSquad,
} from '@/lib/queries';
import { requireSupabase } from '@/lib/supabase';
import { SquadList } from './SquadList';

export function DashboardScreen() {
  const { session, profile } = useAuth();
  const gameweeks = useGameweeks();
  const players = usePlayers();
  const sides = useSides();
  const table = useLeagueTable();
  const all = gameweeks.data ?? [];
  const next = nextOpenGameweek(all);
  const locked = lockedGameweeks(all);
  const last = locked.at(-1);
  const userId = session?.user.id;
  const upcoming = useSquad(userId, next?.id);
  const lastSquad = useSquad(userId, last?.id);
  const history = useQueries({
    queries: locked.map((gw) => ({
      queryKey: keys.squad(userId ?? '', gw.id),
      enabled: Boolean(userId),
      queryFn: async () => {
        const { data, error } = await requireSupabase().rpc('squad_for', {
          p_user: userId as string,
          p_gameweek: gw.id,
        });
        if (error) throw error;
        return data;
      },
    })),
  });

  if (!session) return <Navigate to="/login" replace />;
  if (gameweeks.isLoading || players.isLoading || sides.isLoading) return <Loading />;
  if (gameweeks.error) return <ErrorText error={gameweeks.error} />;

  const me = table.data?.find((r) => r.user_id === userId);
  const lastTotal = (lastSquad.data ?? []).reduce((s, r) => s + r.points, 0);

  return (
    <>
      <h1>{profile?.team_name}</h1>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat value={me?.total ?? 0} label="Total points" />
        <Stat
          value={
            <>
              {me?.rank ?? '-'}
              <small className="muted text-base">/{table.data?.length ?? 0}</small>
            </>
          }
          label="League position"
        />
        <Stat value={lastTotal} label={last ? gameweekLabel(last, all) : 'Last gameweek'} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <h2>Next up{next ? `: ${gameweekLabel(next, all)}` : ''}</h2>
          {!next && <p className="muted">No upcoming gameweeks yet.</p>}
          {next && (
            <>
              <p className="muted">Deadline {formatDayTime(next.deadline)}</p>
              {upcoming.isLoading ? (
                <Loading />
              ) : upcoming.data?.length ? (
                <>
                  <SquadList
                    rows={upcoming.data}
                    players={players.data ?? []}
                    sides={sides.data ?? []}
                    showPoints={false}
                  />
                  <Link className="btn mt-3" to="/squad">
                    Make changes
                  </Link>
                </>
              ) : (
                <>
                  <p>You haven&apos;t picked a squad yet.</p>
                  <Link className="btn mt-3" to="/squad">
                    Pick your squad
                  </Link>
                </>
              )}
            </>
          )}
        </section>

        <section className="card">
          <h2>{last ? gameweekLabel(last, all) : 'Last gameweek'}</h2>
          {lastSquad.data?.length ? (
            <SquadList
              rows={lastSquad.data}
              players={players.data ?? []}
              sides={sides.data ?? []}
              showPoints
            />
          ) : (
            <p className="muted">Nothing scored yet.</p>
          )}
        </section>
      </div>

      {locked.length > 0 && (
        <section className="card">
          <h2>Points by gameweek</h2>
          <table className="table">
            <thead>
              <tr>
                {locked.map((gw, i) => (
                  <th key={gw.id} className="num">
                    <Link to={`/teams/${userId}?gw=${gw.id}`}>GW{i + 1}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {history.map((h, i) => (
                  <td key={locked[i]!.id} className="num">
                    {(h.data ?? []).reduce((s, r) => s + r.points, 0)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
