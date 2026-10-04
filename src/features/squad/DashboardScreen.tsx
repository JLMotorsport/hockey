import { useQueries } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import { ErrorText, Loading } from '@/components/ui';
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
  useSeasonPoints,
  useSquad,
} from '@/lib/queries';
import { requireSupabase } from '@/lib/supabase';
import { SquadPitch } from './SquadPitch';

export function DashboardScreen() {
  const { session, profile } = useAuth();
  const gameweeks = useGameweeks();
  const players = usePlayers();
  const sides = useSides();
  const table = useLeagueTable();
  const seasonPoints = useSeasonPoints();
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
  const lastTotal = (lastSquad.data ?? []).reduce((sum, r) => sum + r.points, 0);
  const showLast = Boolean(lastSquad.data?.length);
  const pitchRowsData = showLast ? lastSquad.data! : (upcoming.data ?? []);

  return (
    <>
      <section className="hero">
        <p className="font-display text-sm font-bold uppercase tracking-widest text-white/80">
          {profile?.display_name}
        </p>
        <h1 className="mb-4 mt-0 text-4xl">{profile?.team_name}</h1>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white/15 px-2 py-3">
            <span className="display-num block text-4xl">{lastTotal}</span>
            <span className="text-xs uppercase tracking-wide text-white/80">
              {last ? gameweekLabel(last, all).split(' ')[0] : 'GW'} points
            </span>
          </div>
          <div className="rounded-xl bg-white px-2 py-3 text-brand">
            <span className="display-num block text-4xl">{me?.total ?? 0}</span>
            <span className="text-xs font-semibold uppercase tracking-wide">Total</span>
          </div>
          <div className="rounded-xl bg-white/15 px-2 py-3">
            <span className="display-num block text-4xl">
              {me?.rank ?? '-'}
              <span className="text-lg text-white/70">/{table.data?.length ?? 0}</span>
            </span>
            <span className="text-xs uppercase tracking-wide text-white/80">Position</span>
          </div>
        </div>
      </section>

      {next && (
        <section className="card flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-display text-sm font-bold uppercase tracking-wide text-ink-soft">
              Next deadline
            </p>
            <p className="font-display text-2xl font-extrabold uppercase">
              {gameweekLabel(next, all)}
            </p>
            <p className="muted text-sm">{formatDayTime(next.deadline)}</p>
          </div>
          <Link className="btn" to="/squad">
            {upcoming.data?.length ? 'Make changes' : 'Pick your squad'}
          </Link>
        </section>
      )}

      {pitchRowsData.length > 0 ? (
        <section className="mb-4">
          <h2>{showLast && last ? `${gameweekLabel(last, all)} points` : 'Your squad'}</h2>
          <SquadPitch
            rows={pitchRowsData}
            players={players.data ?? []}
            sides={sides.data ?? []}
            showPoints={showLast}
            seasonPoints={seasonPoints.data}
          />
        </section>
      ) : (
        !next && <p className="muted">No upcoming gameweeks yet.</p>
      )}

      {last && (
        <Link
          to="/team-of-the-week"
          className="card flex items-center justify-between gap-3 text-ink no-underline hover:border-brand hover:no-underline"
        >
          <span>
            <span className="block font-display text-sm font-bold uppercase tracking-wide text-ink-soft">
              {gameweekLabel(last, all).split(' ')[0]}
            </span>
            <span className="font-display text-2xl font-extrabold uppercase">Team of the week</span>
          </span>
          <span className="font-display text-3xl text-brand" aria-hidden="true">
            ›
          </span>
        </Link>
      )}

      {locked.length > 0 && (
        <section className="card">
          <h2>Points by gameweek</h2>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {locked.map((gw, i) => (
              <Link
                key={gw.id}
                to={`/teams/${userId}?gw=${gw.id}`}
                className="flex min-w-[4rem] flex-col items-center rounded-xl border border-line px-3 py-2 text-ink no-underline hover:border-brand hover:no-underline"
              >
                <span className="font-display text-xs font-bold uppercase text-ink-soft">
                  GW{i + 1}
                </span>
                <span className="display-num text-2xl">
                  {(history[i]?.data ?? []).reduce((sum, r) => sum + r.points, 0)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
