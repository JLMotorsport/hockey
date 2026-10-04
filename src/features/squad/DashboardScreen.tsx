import { chipName } from '@/lib/chips';
import { useQueries } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import { ErrorText, Loading } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { formatWeekdayTime, gameweekLabel } from '@/lib/format';
import {
  keys,
  lockedGameweeks,
  nextOpenGameweek,
  useGameweeks,
  useLeagueTable,
  usePlayers,
  useSides,
  useSeasonPoints,
  squadTotal,
  useChips,
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
  const chips = useChips(userId);
  const chipFor = (gw: number | undefined) => chips.data?.find((c) => c.gameweek_id === gw);
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
  const lastTotal = squadTotal(lastSquad.data);
  const showLast = Boolean(lastSquad.data?.length);
  const pitchRowsData = showLast ? lastSquad.data! : (upcoming.data ?? []);

  const weekTotals = locked.map((gw, i) => ({ gw, i, pts: squadTotal(history[i]?.data) }));
  const bestWeek = Math.max(1, ...weekTotals.map((w) => w.pts));
  const chipWeeks = weekTotals.filter((w) => chipFor(w.gw.id));
  const daysLeft = next
    ? Math.max(0, Math.ceil((new Date(next.deadline).getTime() - Date.now()) / 86_400_000))
    : 0;

  return (
    <>
      <section className="hero">
        <p className="font-display text-sm font-bold uppercase tracking-widest text-white/85">
          {profile?.display_name}
        </p>
        <h1 className="mb-3 mt-0 text-4xl leading-none">{profile?.team_name}</h1>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white/15 px-2 py-2">
            <span className="display-num block text-3xl">{lastTotal}</span>
            <span className="text-[0.7rem] uppercase tracking-wide text-white/85">
              {last ? gameweekLabel(last, all).split(' ')[0] : 'GW'} pts
            </span>
          </div>
          <div className="rounded-xl bg-white px-2 py-2 text-brand">
            <span className="display-num block text-3xl">{me?.total ?? 0}</span>
            <span className="text-[0.7rem] font-semibold uppercase tracking-wide">Total</span>
          </div>
          <div className="rounded-xl bg-white/15 px-2 py-2">
            <span className="display-num block text-3xl">
              {me?.rank ?? '-'}
              <span className="text-lg text-white/75">/{table.data?.length ?? 0}</span>
            </span>
            <span className="text-[0.7rem] uppercase tracking-wide text-white/85">Position</span>
          </div>
        </div>
        {next && (
          <Link
            to={upcoming.data?.length ? '/squad' : '/transfers'}
            className="mt-3 flex min-h-tap items-center gap-3 rounded-xl bg-black/20 px-3 py-2 text-white no-underline hover:no-underline"
          >
            <span className="flex flex-1 flex-col leading-tight">
              <span className="text-[0.7rem] uppercase tracking-wide text-white/85">
                {gameweekLabel(next, all).split(' ')[0]} deadline
              </span>
              <span className="font-bold">
                {formatWeekdayTime(next.deadline)}
                {daysLeft > 0 && ` · ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}
              </span>
            </span>
            <span className="rounded-full bg-white px-3 py-1.5 font-display text-sm font-extrabold uppercase text-brand">
              {upcoming.data?.length ? 'Make changes' : 'Pick squad'}
            </span>
          </Link>
        )}
      </section>

      {pitchRowsData.length > 0 ? (
        <section className="mb-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2>
              {showLast && last ? `${gameweekLabel(last, all).split(' ')[0]} points` : 'Your squad'}
            </h2>
            <span className="muted text-sm">Tap a player for details</span>
          </div>
          <SquadPitch
            rows={pitchRowsData}
            players={players.data ?? []}
            sides={sides.data ?? []}
            showPoints={showLast}
            gameweekId={last?.id}
            seasonPoints={seasonPoints.data}
            chip={chipFor(showLast ? last?.id : next?.id)}
          />
        </section>
      ) : (
        !next && <p className="muted">No upcoming gameweeks yet.</p>
      )}

      {weekTotals.length > 0 && (
        <section className="card">
          <h2>Your season</h2>
          <div className="flex h-36 items-end gap-3 overflow-x-auto pb-1">
            {weekTotals.map(({ gw, i, pts }) => (
              <Link
                key={gw.id}
                to={`/teams/${userId}?gw=${gw.id}`}
                className="flex w-12 shrink-0 flex-col items-center gap-1 text-ink no-underline hover:no-underline"
                aria-label={`GW${i + 1}: ${pts} points${chipFor(gw.id) ? `, ${chipName(chipFor(gw.id)!.chip)}` : ''}`}
              >
                <span className="display-num text-lg">{pts}</span>
                <span
                  className={`w-9 rounded-t-md ${chipFor(gw.id) ? 'bg-[#16181d] dark:bg-white' : 'bg-brand'}`}
                  style={{ height: `${Math.max(4, Math.round((pts / bestWeek) * 88))}px` }}
                />
                <span className="muted text-xs">GW{i + 1}</span>
              </Link>
            ))}
          </div>
          {chipWeeks.length > 0 && (
            <p className="muted mt-2 text-sm">
              Dark bars: chips played (
              {chipWeeks.map((w) => `${chipName(chipFor(w.gw.id)!.chip)} GW${w.i + 1}`).join(', ')})
            </p>
          )}
        </section>
      )}

      {last && (
        <Link
          to="/team-of-the-week"
          className="mb-4 flex min-h-tap items-center gap-3 rounded-2xl bg-[#16181d] px-4 py-3 text-white no-underline hover:no-underline"
        >
          <span className="flex flex-1 flex-col">
            <span className="text-xs uppercase tracking-wider text-white/80">
              {gameweekLabel(last, all).split(' ')[0]}
            </span>
            <span className="font-display text-2xl font-extrabold uppercase">Team of the week</span>
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>
      )}
    </>
  );
}
