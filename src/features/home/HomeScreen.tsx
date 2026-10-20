import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { CalendarIcon, PitchIcon, SwapIcon } from '@/components/icons';
import { ErrorText, Loading } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { countdown, liveGameweek, myPlace, ordinal, weekSpread } from '@/lib/home';
import {
  nextOpenGameweek,
  squadTotal,
  transferSummaryQuery,
  useGameweeks,
  useLeagueTable,
  usePlayers,
  useProfileSides,
  useFixtures,
  useSettings,
  useSides,
  useSquad,
} from '@/lib/queries';
import { useTransitionClick } from '@/lib/navTransition';
import { inLeague, type LeagueKey } from '@/lib/table';
import { SquadPitch } from '@/features/squad/SquadPitch';
import { NoTeamPrompt } from '@/components/NoTeamPrompt';
import { useWide } from '@/lib/useWide';
import { FdrBadge } from '@/features/league/Difficulty';
import { useDifficulty } from '@/lib/useDifficulty';
import { difficulty, placeLine } from '@/lib/fdr';
import { opponentName } from '@/lib/form';
import { formatDeadline, formatWeekdayTime } from '@/lib/format';

/** The minute, so the countdown keeps up. */
function useNow(ms = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * Home, as FPL's: your team card with the deadline and the way to Pick Team
 * and Transfers; once a gameweek is live, its points first. Then the links
 * and your mini leagues.
 */
export function HomeScreen() {
  const { session, profile } = useAuth();
  const now = useNow();
  const gameweeks = useGameweeks();
  const players = usePlayers();
  const sides = useSides();
  const table = useLeagueTable();
  const sideOf = useProfileSides();
  const all = gameweeks.data ?? [];
  const next = nextOpenGameweek(all);
  const live = liveGameweek(all, now);
  const userId = session?.user.id;
  const liveSquad = useSquad(userId, live?.id);
  const liveHit = useQuery(transferSummaryQuery(userId, live?.id)).data?.hit ?? 0;
  const nextSquad = useSquad(userId, next?.id);
  const transitionClick = useTransitionClick();
  const wide = useWide();
  // Loaded now so Pick Team and Transfers open straight away.
  useSettings();
  usePreviousSquadWarm(userId, all, next?.id);

  if (!session) return <Navigate to="/login" replace />;
  if (gameweeks.isLoading || players.isLoading || sides.isLoading) return <Loading />;
  if (gameweeks.error) return <ErrorText error={gameweeks.error} />;

  const number = (id: number) => {
    const gw = all.find((g) => g.id === id);
    return gw ? all.filter((g) => g.start_date <= gw.start_date).length : 0;
  };
  const mySide = (sides.data ?? []).find((s) => s.id === profile?.side_id);
  const rows = table.data ?? [];
  const spread = weekSpread(rows);
  const me = rows.find((r) => r.user_id === userId);
  const hasSquad = (nextSquad.data?.length ?? 0) > 0;
  const sideList = sides.data ?? [];
  const sideMap = sideOf.data ?? new Map<string, number | null>();
  const leagues: [LeagueKey, string][] = [
    ['all', 'Overall'],
    ...(mySide
      ? ([
          /^w/i.test(mySide.short_name) ? ['women', "Women's"] : ['men', "Men's"],
          [`side:${mySide.id}`, mySide.short_name],
        ] as [LeagueKey, string][])
      : []),
  ];

  const teamHead = (
    <>
      <Link
        to="/dashboard"
        className="flex min-h-tap items-center gap-3 text-white no-underline hover:no-underline"
      >
        <span className="flex h-[3.4rem] w-[3.4rem] shrink-0 items-center justify-center rounded-xl bg-white">
          <img src="/crest.png" alt="" className="h-11 w-11" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[1.3rem] font-extrabold leading-tight">
            {profile?.team_name}
          </span>
          <span className="truncate text-sm text-white/90">
            {profile?.display_name}
            {mySide && ` · plays for ${mySide.short_name}`}
          </span>
        </span>
        {wide && me && (
          <span className="flex flex-col items-end">
            <span className="display-num text-[2.1rem] leading-none">{me.total}</span>
            <span className="text-xs text-white/85">
              points, {ordinal(me.rank)} of {rows.length}
            </span>
          </span>
        )}
        <span aria-hidden="true" className="text-2xl">
          →
        </span>
      </Link>
      <div className="mx-12 my-3 h-px bg-white/25" />
    </>
  );

  const mainCard = (
    <>
      {live ? (
        <section className="rounded-[1.1rem] bg-[#b5222a] px-3 pb-3 pt-4 text-white">
          {teamHead}
          <p className="m-0 flex items-center justify-center gap-2 text-sm">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#7dff9e]" />
            Gameweek {number(live.id)} · Live
          </p>
          <div className="mt-1.5 grid grid-cols-[1fr_1.2fr_1fr] items-end text-center">
            <Stat value={spread.average} label="Average" />
            <span className="flex flex-col">
              <span className="display-num text-[3.5rem] leading-[0.9]">
                {squadTotal(liveSquad.data) - liveHit}
              </span>
              <span className="text-xs text-white/90">
                {liveHit ? `Your points (-${liveHit} transfers)` : 'Your points'}
              </span>
            </span>
            <Stat value={spread.highest} label="Highest" />
          </div>
          {liveSquad.data?.length ? (
            <div className="mt-3">
              <SquadPitch
                rows={liveSquad.data}
                players={players.data ?? []}
                sides={sideList}
                showPoints
                gameweekId={live.id}
                compact
                live
              />
            </div>
          ) : (
            <p className="mb-0 mt-3 text-center text-sm text-white/90">
              You had no team this gameweek.
            </p>
          )}
        </section>
      ) : (
        next && (
          <section className="rounded-[1.1rem] bg-[#b5222a] p-4 text-white">
            {teamHead}
            <p className="m-0 text-center text-[0.95rem] text-white/90">
              Gameweek {number(next.id)}
            </p>
            <p className="mb-0.5 mt-1 text-center font-extrabold">
              Deadline: {formatDeadline(next.deadline, true)}
            </p>
            <p className="mb-3 mt-0 text-center text-xs text-white/80">
              {countdown(next.deadline, now)}
            </p>
            <div className="flex flex-col gap-2 lg:grid lg:grid-cols-3">
              <CardButton to={hasSquad ? '/squad' : '/transfers'} icon={<PitchIcon />}>
                {hasSquad ? 'Pick Team' : 'Pick your squad'}
              </CardButton>
              <CardButton to="/transfers" icon={<SwapIcon />}>
                Transfers
              </CardButton>
              <CardButton to="/fixtures" icon={<CalendarIcon />}>
                Gameweek {number(next.id)} Fixtures
              </CardButton>
            </div>
          </section>
        )
      )}
    </>
  );
  const liveNext = (
    <>
      {/* While a gameweek is live, the next one's buttons stay in reach. */}
      {live && next && (
        <section className="mt-2.5 rounded-[0.9rem] bg-surface px-3.5 pb-3 pt-3.5 shadow-card dark:shadow-none">
          <p className="m-0 text-center text-sm text-ink-soft">Gameweek {number(next.id)}</p>
          <p className="mb-2.5 mt-0.5 text-center text-[0.95rem] font-extrabold">
            Deadline: {formatDeadline(next.deadline, true)}
          </p>
          <div className="flex gap-2">
            {(
              [
                [hasSquad ? '/squad' : '/transfers', 'Pick Team'],
                ['/transfers', 'Transfers'],
              ] as const
            ).map(([to, label]) => (
              <Link
                key={label}
                to={to}
                onClick={transitionClick(to, 'forward')}
                className="flex min-h-[46px] flex-1 items-center justify-center rounded-full bg-black/[0.06] font-bold text-ink no-underline hover:no-underline dark:bg-[#1f232c]"
              >
                {label}
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
  const links = (
    <>
      {/* FPL's links, as far as hockey has them (no fixture difficulty or set pieces). */}
      <nav
        aria-label="More"
        className="mt-2.5 rounded-[0.9rem] bg-surface px-4 py-0.5 shadow-card dark:shadow-none"
      >
        {(
          [
            ['/fixtures', 'Fixtures', 'This gameweek and results'],
            ['/players?sort=change', 'Price Changes', 'Who went up or down this week'],
            ['/players', 'Player Statistics', 'Every player, stats scroll sideways'],
            ['/team-of-the-week', 'Team of the Week', 'Best 11 from last gameweek'],
            ['/rules', 'Rules', 'Points, chips and deadlines'],
          ] as const
        ).map(([to, title, help], i) => (
          <Link
            key={to}
            to={to}
            className={`flex min-h-[3.2rem] items-center justify-between gap-3 py-1.5 text-ink no-underline hover:no-underline ${i ? 'border-t border-line' : ''}`}
          >
            <span className="flex flex-col">
              <span className="text-base font-bold">{title}</span>
              <span className="text-xs text-ink-soft">{help}</span>
            </span>
            <span aria-hidden="true" className="text-xl text-ink-soft">
              ›
            </span>
          </Link>
        ))}
      </nav>
    </>
  );
  const leaguesCard = (
    <>
      <section className="mt-2.5 rounded-[0.9rem] bg-surface px-4 pb-2 pt-3.5 shadow-card dark:shadow-none">
        <h2 className="mb-2 font-sans text-[1.3rem] font-extrabold normal-case tracking-normal [font-stretch:100%]">
          Leagues
        </h2>
        {leagues.map(([key, label]) => {
          const place = userId ? myPlace(rows, inLeague(key, sideMap, sideList), userId) : null;
          const moved = place?.moved ?? 0;
          return (
            <Link
              key={key}
              to={`/table?league=${encodeURIComponent(key)}`}
              className="mb-1.5 flex min-h-[3rem] items-center gap-2.5 rounded-[0.6rem] bg-black/[0.04] px-3 text-ink no-underline hover:no-underline dark:bg-[#1f232c]"
            >
              <span className="flex-1 font-semibold">{label}</span>
              <span className="font-extrabold">{place ? ordinal(place.rank) : '-'}</span>
              <span
                aria-label={moved > 0 ? `Up ${moved}` : moved < 0 ? `Down ${-moved}` : 'No change'}
                className={`flex h-[1.4rem] w-[1.4rem] items-center justify-center rounded-full text-xs text-white ${moved > 0 ? 'bg-[#1f7a4d]' : moved < 0 ? 'bg-brand' : 'bg-[#4b5260]'}`}
              >
                {moved > 0 ? '▲' : moved < 0 ? '▼' : '–'}
              </span>
            </Link>
          );
        })}
        {!mySide && (
          <p className="muted mb-1 mt-1 text-sm">
            <Link to="/account">Set the side you play for</Link> to join the Men&apos;s or
            Women&apos;s league and your side&apos;s league.
          </p>
        )}
      </section>
    </>
  );

  // A PC: your team and this gameweek's games on the left, leagues and links on the right.
  if (wide)
    return (
      <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-start gap-5 pt-5 [&_section]:mt-0 [&_nav]:mt-0">
        <div className="flex flex-col gap-4">
          <NoTeamPrompt />
          {mainCard}
          {liveNext}
          {next && (
            <GameweekGames gameweekId={next.id} label={`Gameweek ${number(next.id)} games`} />
          )}
        </div>
        <div className="flex flex-col gap-4">
          {leaguesCard}
          {links}
        </div>
      </div>
    );

  return (
    <div className="-mx-2 pt-2.5 sm:mx-auto sm:max-w-[26rem]">
      <NoTeamPrompt />
      {mainCard}
      {liveNext}
      {links}
      {leaguesCard}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-xl font-extrabold">{value}</span>
      <span className="text-[0.7rem] text-white/85">{label}</span>
    </span>
  );
}

function CardButton({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  const transitionClick = useTransitionClick();
  return (
    <Link
      to={to}
      onClick={transitionClick(to, 'forward')}
      className="flex min-h-[46px] items-center justify-center gap-2 rounded-full bg-black/20 text-base font-bold text-white no-underline hover:no-underline [&>svg]:h-5 [&>svg]:w-5"
    >
      {icon}
      {children}
    </Link>
  );
}

/** The squad before the next gameweek, which Transfers counts transfers against. */
function usePreviousSquadWarm(
  userId: string | undefined,
  all: { id: number; start_date: string }[],
  nextId: number | undefined,
) {
  const next = all.find((g) => g.id === nextId);
  const previous = next
    ? [...all].reverse().find((g) => g.start_date < next.start_date)
    : undefined;
  useSquad(userId, previous?.id);
}

/** PC Home: each side's game in a gameweek, with its difficulty when that's shown. */
function GameweekGames({ gameweekId, label }: { gameweekId: number; label: string }) {
  const fixtures = useFixtures();
  const sides = useSides();
  const fdr = useDifficulty();
  const games = (fixtures.data ?? []).filter((f) => f.gameweek_id === gameweekId);
  return (
    <section className="rounded-[0.9rem] bg-surface px-4 pb-1.5 pt-3.5 shadow-card dark:shadow-none">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="m-0">{label}</h2>
        <Link to="/fixtures" className="text-sm font-semibold">
          All fixtures
        </Link>
      </div>
      <ul>
        {(sides.data ?? []).map((side) => {
          const f = games.find((g) => g.side_id === side.id);
          const place = f && fdr.show ? fdr.places.get(f.id) : undefined;
          const rated =
            f && place ? difficulty(place.position, place.teams, f.is_home, place.ours) : null;
          return (
            <li
              key={side.id}
              className="flex min-h-tap items-center gap-3 border-t border-line py-1.5"
            >
              <span className="w-9 shrink-0 rounded-md bg-[#16181d] py-0.5 text-center font-display text-sm font-bold text-white">
                {side.short_name}
              </span>
              {f ? (
                <>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-semibold">
                      {opponentName(f.opponent)} ({f.is_home ? 'H' : 'A'})
                    </span>
                    {rated && <span className="muted text-xs">{placeLine(f.is_home, place)}</span>}
                  </span>
                  <span className="muted whitespace-nowrap text-sm tabular-nums">
                    {formatWeekdayTime(f.kickoff)}
                  </span>
                  {rated && <FdrBadge rating={rated} />}
                </>
              ) : (
                <span className="muted flex-1">No game</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
