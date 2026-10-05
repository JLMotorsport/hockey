import { chipName } from '@/lib/chips';
import { useQueries } from '@tanstack/react-query';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { defaultGameweek } from '@/lib/gameweek';
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
  const [params, setParams] = useSearchParams();
  // Past gameweeks plus the one being picked for, oldest first.
  const browsable = next ? [...locked, next] : locked;
  const viewing =
    browsable.find((g) => g.id === Number(params.get('gw'))) ?? defaultGameweek(browsable);
  const viewingIndex = viewing ? browsable.findIndex((g) => g.id === viewing.id) : -1;
  const viewingUpcoming = Boolean(viewing && next && viewing.id === next.id);
  const upcoming = useSquad(userId, next?.id);
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
  const viewedRows = viewingUpcoming
    ? (upcoming.data ?? [])
    : (history[locked.findIndex((g) => g.id === viewing?.id)]?.data ?? []);
  const viewedLabel = viewing ? gameweekLabel(viewing, all).split(' ')[0] : '';
  const go = (i: number) => {
    const gw = browsable[i];
    if (gw) setParams({ gw: String(gw.id) }, { replace: true });
  };

  const weekTotals = locked.map((gw, i) => ({ gw, i, pts: squadTotal(history[i]?.data) }));
  const bestWeek = Math.max(1, ...weekTotals.map((w) => w.pts));
  const chipWeeks = weekTotals.filter((w) => chipFor(w.gw.id));
  const daysLeft = next
    ? Math.max(0, Math.ceil((new Date(next.deadline).getTime() - Date.now()) / 86_400_000))
    : 0;

  return (
    <>
      {/* Scoreboard: the week you're looking at, big, with arrows either side. */}
      {viewing ? (
        <section className="hero !mb-2 !pb-2 !pt-1.5">
          <div className="flex items-center gap-1.5">
            <ArrowButton
              label="Previous gameweek"
              disabled={viewingIndex <= 0}
              onClick={() => go(viewingIndex - 1)}
              d="M15 6l-6 6 6 6"
            />
            <div className="flex min-w-0 flex-1 items-center justify-center gap-3">
              <div className="flex flex-col items-center leading-none">
                <span className="font-display text-xs font-bold uppercase text-white/85">
                  {viewingUpcoming
                    ? 'Your team'
                    : `${viewedLabel} · ${gameweekLabel(viewing, all)
                        .replace(/^GW\d+ /, '')
                        .replace(/[()]/g, '')}`}
                </span>
                <span className="display-num text-[2.9rem] leading-[0.95]">
                  {viewingUpcoming ? viewedLabel : squadTotal(viewedRows)}
                </span>
                <span className="text-[0.7rem] text-white/85">
                  {viewingUpcoming ? 'next up' : 'points'}
                </span>
              </div>
              <div className="flex min-w-0 flex-col gap-1 border-l border-white/30 pl-3 text-xs">
                <span>
                  <span className="text-white/80">Total</span>{' '}
                  <b className="display-num text-lg">{me?.total ?? 0}</b>
                </span>
                <span className="whitespace-nowrap">
                  <span className="text-white/80">Position</span>{' '}
                  <b className="display-num text-lg">{me?.rank ? ordinal(me.rank) : '-'}</b>
                  <span className="text-white/80"> of {table.data?.length ?? 0}</span>
                </span>
                {chipFor(viewing.id) && (
                  <span className="self-start rounded-full bg-black/25 px-2 py-px text-[0.7rem]">
                    {chipName(chipFor(viewing.id)!.chip)}
                  </span>
                )}
              </div>
            </div>
            <ArrowButton
              label="Next gameweek"
              disabled={viewingIndex >= browsable.length - 1}
              onClick={() => go(viewingIndex + 1)}
              d="M9 6l6 6-6 6"
            />
          </div>
        </section>
      ) : (
        <section className="hero">
          <h1 className="m-0 text-3xl leading-none">{profile?.team_name}</h1>
        </section>
      )}

      {viewing && (
        <section className="mb-4">
          {viewedRows.length > 0 ? (
            <SquadPitch
              rows={viewedRows}
              players={players.data ?? []}
              sides={sides.data ?? []}
              showPoints={!viewingUpcoming}
              gameweekId={viewingUpcoming ? last?.id : viewing.id}
              seasonPoints={seasonPoints.data}
              chip={chipFor(viewing.id)}
              fixturesFor={viewingUpcoming ? viewing.id : undefined}
              compact
            />
          ) : (
            <div className="card text-center">
              <p className="muted mb-3">
                {viewingUpcoming ? 'No squad picked yet.' : 'You had no squad this gameweek.'}
              </p>
              {viewingUpcoming && (
                <Link className="btn" to="/transfers">
                  Pick your squad
                </Link>
              )}
            </div>
          )}
        </section>
      )}
      {!viewing && <p className="muted">No gameweeks yet.</p>}

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

      {/* What's next, always in view: sits on the tab bar on phones. */}
      {next && (
        <>
          <div className="fixed inset-x-0 bottom-[calc(4rem+1px+env(safe-area-inset-bottom))] z-20 flex items-center gap-3 border-t border-line bg-surface py-1.5 pl-4 pr-2 sm:sticky sm:bottom-4 sm:mt-4 sm:rounded-2xl sm:border sm:pr-3 sm:shadow-card">
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="text-[0.62rem] uppercase tracking-wider text-ink-soft">
                {gameweekLabel(next, all).split(' ')[0]} deadline
              </span>
              <span className="display-num truncate text-lg">
                {formatWeekdayTime(next.deadline)}
                {daysLeft > 0 && (
                  <span className="text-sm text-ink-soft">
                    {' '}
                    · {daysLeft} day{daysLeft === 1 ? '' : 's'}
                  </span>
                )}
              </span>
            </span>
            <Link
              to={upcoming.data?.length ? '/squad' : '/transfers'}
              className="btn shrink-0 px-5"
            >
              {upcoming.data?.length ? 'Make changes' : 'Pick squad'}
            </Link>
          </div>
          <div className="h-16 sm:hidden" />
        </>
      )}
    </>
  );
}

function ArrowButton({
  label,
  disabled,
  onClick,
  d,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  d: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/20 text-white disabled:opacity-30"
    >
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
        <path d={d} />
      </svg>
    </button>
  );
}

/** 3 -> "3rd" */
function ordinal(n: number): string {
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
  return `${n}${suffix}`;
}
