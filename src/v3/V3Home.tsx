import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ErrorText, Loading } from '@/components/ui';
import { PlayerSheet } from '@/features/player/PlayerDetail';
import { useAuth } from '@/lib/auth/AuthProvider';
import { formatDeadline, formatWeekdayTime } from '@/lib/format';
import { formationOf } from '@/lib/formation';
import {
  liveGameweek,
  myPlace,
  ordinal,
  shortCountdown,
  timeUnknown,
  weekSpread,
} from '@/lib/home';
import { useTransitionClick } from '@/lib/navTransition';
import { opponentCode } from '@/lib/pickDisplay';
import {
  nextOpenGameweek,
  squadTotal,
  transferSummaryQuery,
  useFixtures,
  useFixturesWithStats,
  useGameweeks,
  useLeagueTable,
  usePlayers,
  useProfileSides,
  useSettings,
  useSides,
  useSquad,
} from '@/lib/queries';
import type { Position } from '@/lib/scoring';
import { inLeague, type LeagueKey } from '@/lib/table';
import { TeamPitch } from './TeamPitch';
import { useSquadBadges } from './useSquadBadges';

function useNow(ms = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** V3 Home (approved boards "Home, before the deadline" and "Home, gameweek live"). */
export function V3Home() {
  const { session, profile } = useAuth();
  const now = useNow();
  const gameweeks = useGameweeks();
  const players = usePlayers();
  const sides = useSides();
  const table = useLeagueTable();
  const sideOf = useProfileSides();
  const fixtures = useFixtures();
  const settings = useSettings();
  const all = gameweeks.data ?? [];
  const next = nextOpenGameweek(all);
  const live = liveGameweek(all, now);
  const userId = session?.user.id;
  const liveSquad = useSquad(userId, live?.id);
  const liveHit = useQuery(transferSummaryQuery(userId, live?.id)).data?.hit ?? 0;
  const nextSquad = useSquad(userId, next?.id);
  const withStats = useFixturesWithStats(live?.id);
  const transitionClick = useTransitionClick();
  const [open, setOpen] = useState<number | null>(null);
  const onOpen = useCallback((id: number) => setOpen(id), []);
  const badges = useSquadBadges(
    liveSquad.data,
    players.data ?? [],
    sides.data ?? [],
    live?.id,
    onOpen,
  );

  if (!session) return <Navigate to="/login" replace />;
  if (gameweeks.isLoading || players.isLoading || sides.isLoading) return <Loading />;
  if (gameweeks.error) return <ErrorText error={gameweeks.error} />;

  const number = (id: number) => {
    const gw = all.find((g) => g.id === id);
    return gw ? all.filter((g) => g.start_date <= gw.start_date).length : 0;
  };
  const sideList = sides.data ?? [];
  const sideShort = new Map(sideList.map((s) => [s.id, s.short_name]));
  const mySide = sideList.find((s) => s.id === profile?.side_id);
  const rows = table.data ?? [];
  const sideMap = sideOf.data ?? new Map<string, number | null>();
  const overall = myPlace(rows, () => true, session.user.id);
  const leagues: [LeagueKey, string][] = [
    ['all', 'Overall'],
    ...(mySide
      ? ([
          /^w/i.test(mySide.short_name) ? ['women', "Women's"] : ['men', "Men's"],
          [`side:${mySide.id}`, mySide.short_name],
        ] as [LeagueKey, string][])
      : []),
  ];
  const moved = (n: number) =>
    n > 0 ? (
      <span className="text-[rgb(var(--v3-mint))]">▲{n}</span>
    ) : n < 0 ? (
      <span className="text-[rgb(var(--v3-red))]">▼{-n}</span>
    ) : (
      <span className="text-[rgb(var(--v3-mut))]">–</span>
    );

  const top = (sub: React.ReactNode, right: React.ReactNode) => (
    <header className="flex items-center justify-between px-[18px] pb-2.5 pt-1.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="v3-red v3-glow v3-disp flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px]">
          FHC
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="v3-cap flex items-center gap-1.5">{sub}</span>
          <span className="v3-disp truncate text-[22px]">{profile?.team_name}</span>
        </span>
      </div>
      {right}
    </header>
  );

  // ---------- Gameweek live ----------
  if (live && liveSquad.data?.length) {
    const spread = weekSpread(rows);
    const gwFixtures = (fixtures.data ?? []).filter((f) => f.gameweek_id === live.id);
    const synced = gwFixtures.filter(
      (f) => f.lineup_imported_at !== null || f.stats_locked || withStats.data?.has(f.id),
    ).length;
    return (
      <div className="mx-auto max-w-[26rem]">
        {top(
          <>
            <span className="v3-dot" />
            Gameweek {number(live.id)} · Live
          </>,
          <span className="rounded-full border border-[rgb(63_242_168/.3)] bg-[rgb(63_242_168/.12)] px-3 py-2 text-xs font-bold text-[rgb(var(--v3-mint))]">
            {synced} of {gwFixtures.length} synced
          </span>,
        )}
        <div className="mx-[18px] mb-1.5 grid grid-cols-[1fr_1.4fr_1fr] items-end text-center">
          <span>
            <span className="v3-disp v3-num block text-[34px] text-[rgb(var(--v3-mut))]">
              {spread.average}
            </span>
            <span className="v3-cap">Avg</span>
          </span>
          <span>
            <span className="v3-disp v3-num block text-[80px] [text-shadow:0_0_30px_rgb(255_51_71/.55)]">
              {squadTotal(liveSquad.data) - liveHit}
            </span>
            <span className="v3-cap text-[rgb(var(--v3-ice))]">
              {liveHit ? `Your points · -${liveHit}` : 'Your points'}
            </span>
          </span>
          <span>
            <span className="v3-disp v3-num block text-[34px] text-[rgb(var(--v3-mut))]">
              {spread.highest}
            </span>
            <span className="v3-cap">Top</span>
          </span>
        </div>
        <div className="px-3">
          <TeamPitch rows={badges.pitch} height={360} />
        </div>
        {/* Where you stand right now in each of your leagues, as points come in. */}
        <section className="v3-glass mx-3.5 mt-3 rounded-[18px] px-3.5 pb-1 pt-2.5">
          <span className="flex items-center gap-2">
            <span className="v3-dot" />
            <span className="v3-cap">Live positions</span>
          </span>
          <ul className="divide-y divide-white/10">
            {leagues.map(([key, label], i) => {
              const place = myPlace(rows, inLeague(key, sideMap, sideList), session.user.id);
              return (
                <li key={key} className="v3-in" style={{ animationDelay: `${i * 80}ms` }}>
                  <Link
                    to={`/table?league=${encodeURIComponent(key)}`}
                    onClick={transitionClick(`/table?league=${encodeURIComponent(key)}`, 'swap')}
                    className="flex min-h-[48px] items-center gap-2.5 text-[13px] text-white no-underline hover:no-underline"
                  >
                    <span className="flex-1">{label}</span>
                    <span className="v3-num w-9 text-right text-xs">
                      {place ? moved(place.moved) : null}
                    </span>
                    <span className="min-w-[76px] text-right">
                      <span className="v3-disp v3-num text-[22px]">
                        {place ? ordinal(place.rank) : '-'}
                      </span>
                      <span className="text-[11px] text-[rgb(var(--v3-mut))]">
                        {place ? ` of ${place.of}` : ''}
                      </span>
                    </span>
                    <span className="text-[rgb(var(--v3-mut))]">›</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {!mySide && (
            <p className="mb-2 text-xs text-[rgb(var(--v3-mut))]">
              <Link to="/account">Set the side you play for</Link> to see your side&apos;s league.
            </p>
          )}
        </section>
        {next && (
          <div className="mx-3.5 mt-2.5 flex items-center gap-2.5 text-[13px] text-[rgb(var(--v3-mut))]">
            <span className="flex-1">
              GW{number(next.id)} locks {formatDeadline(next.deadline)}
            </span>
            <Link
              to="/squad"
              onClick={transitionClick('/squad', 'forward')}
              className="v3-btn v3-glass min-h-[44px] rounded-xl px-4 text-[13px] text-white no-underline hover:no-underline"
            >
              Pick team
            </Link>
          </div>
        )}
        {open && <PlayerSheet playerId={open} gameweekId={live.id} onClose={() => setOpen(null)} />}
      </div>
    );
  }

  // ---------- Before the deadline ----------
  const gwFixtures = next
    ? (fixtures.data ?? [])
        .filter((f) => f.gameweek_id === next.id)
        .sort((a, b) => a.kickoff.localeCompare(b.kickoff))
    : [];
  const timed = gwFixtures.filter((f) => !timeUnknown(f.kickoff));
  const first = timed[0];
  const left = next ? new Date(next.deadline).getTime() - now.getTime() : 0;
  const week = 7 * 86_400_000;
  const ring = 327;
  const offset = ring * Math.min(1, Math.max(0, left / week));
  const squad = nextSquad.data ?? [];
  const byId = new Map((players.data ?? []).map((p) => [p.id, p]));
  const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 } as Record<Position, number>;
  for (const r of squad) {
    const pos = byId.get(r.player_id)?.position;
    if (r.bench_order === null && pos) counts[pos] += 1;
  }
  const captain = byId
    .get(squad.find((r) => r.is_captain)?.player_id ?? 0)
    ?.name.split(' ')
    .at(-1);
  const go = squad.length ? '/squad' : '/transfers';

  return (
    <div className="mx-auto max-w-[26rem]">
      {top(
        next ? `Gameweek ${number(next.id)}` : 'Season',
        overall && (
          <span className="v3-glass flex items-center gap-1.5 rounded-full px-3 py-2">
            <span className="v3-num text-sm">{ordinal(overall.rank)}</span>
            <span className="v3-num text-sm">{moved(overall.moved)}</span>
          </span>
        ),
      )}
      {next ? (
        <section className="v3-glass v3-in mx-3.5 flex items-center gap-4 rounded-[26px] p-4">
          <div className="relative h-[104px] w-[104px] shrink-0">
            <svg
              width="104"
              height="104"
              viewBox="0 0 120 120"
              className="-rotate-90"
              aria-hidden="true"
            >
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke="rgb(255 255 255 / .08)"
                strokeWidth="8"
              />
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke="url(#v3ring)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={ring}
                strokeDashoffset={ring - offset}
                style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1)' }}
              />
              <defs>
                <linearGradient id="v3ring">
                  <stop offset="0" stopColor="#ff6b7a" />
                  <stop offset="1" stopColor="#ff1f37" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="v3-disp v3-num whitespace-nowrap text-[26px]">
                {shortCountdown(next.deadline, now)}
              </span>
              <span className="v3-cap mt-0.5 text-[9px]">to go</span>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="v3-cap">Squads lock</span>
            <span className="v3-disp text-[26px]">
              {formatDeadline(next.deadline).replace(' at ', ' · ')}
            </span>
            {first && (
              <span className="text-xs text-[rgb(var(--v3-mut))]">
                1 hr before {sideShort.get(first.side_id)} v {opponentCode(first.opponent)}
              </span>
            )}
          </div>
        </section>
      ) : (
        <p className="v3-glass mx-3.5 rounded-[20px] p-4 text-sm">No upcoming gameweek yet.</p>
      )}

      <div className="mx-3.5 mt-2.5 grid grid-cols-[1.2fr_1fr] gap-2.5">
        <Link
          to={go}
          onClick={transitionClick(go, 'forward')}
          className="v3-glow v3-in flex min-h-[104px] flex-col justify-between rounded-[22px] bg-[linear-gradient(150deg,#ff4d5f,#b8101f)] p-3.5 text-white no-underline hover:no-underline"
          style={{ animationDelay: '80ms' }}
        >
          <span className="v3-cap text-white/80">Your XI</span>
          <span className="v3-disp text-[36px]">{squad.length ? 'Pick team' : 'Pick squad'}</span>
          <span className="text-[11px] font-semibold opacity-90">
            {squad.length ? `Captain ${captain ?? '-'} · ${formationOf(counts)}` : 'Choose your 15'}
          </span>
        </Link>
        <Link
          to="/transfers"
          onClick={transitionClick('/transfers', 'forward')}
          className="v3-glass v3-in flex flex-col justify-between rounded-[22px] p-3.5 text-white no-underline hover:no-underline"
          style={{ animationDelay: '140ms' }}
        >
          <span className="v3-cap">Market</span>
          <span className="v3-disp text-[36px]">Transfers</span>
          <span className="v3-num text-xs text-[rgb(var(--v3-mint))]">
            {settings.data ? `${settings.data.transfers_per_gameweek} free a week` : ''}
          </span>
        </Link>
      </div>

      {gwFixtures.length > 0 && (
        <>
          <div className="mx-[18px] mb-2 mt-4 flex items-baseline justify-between">
            <span className="v3-cap">This gameweek</span>
            <Link to="/fixtures" className="text-[11px] text-[rgb(var(--v3-mut))] no-underline">
              {gwFixtures.length} games ›
            </Link>
          </div>
          <div className="flex gap-2 overflow-x-auto px-3.5 pb-1 [scrollbar-width:none]">
            {gwFixtures.map((f, i) => (
              <div
                key={f.id}
                className="v3-glass v3-in w-[104px] shrink-0 rounded-[18px] px-3 py-2.5"
                style={{ animationDelay: `${180 + i * 50}ms` }}
              >
                <span className="v3-cap text-[rgb(var(--v3-ice))]">{sideShort.get(f.side_id)}</span>
                <div className="v3-disp my-1.5 text-[20px]">
                  {opponentCode(f.opponent)} ({f.is_home ? 'H' : 'A'})
                </div>
                <span className="text-[10px] text-[rgb(var(--v3-mut))]">
                  {/T23:00:00|T00:00:00/.test(f.kickoff)
                    ? 'Time TBC'
                    : formatWeekdayTime(f.kickoff)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mx-[18px] mb-2 mt-4 flex items-baseline justify-between">
        <span className="v3-cap">Leagues</span>
        <Link to="/table" className="text-[11px] text-[rgb(var(--v3-mut))] no-underline">
          Table ›
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-2 px-3.5">
        {leagues.map(([key, label]) => {
          const place = myPlace(rows, inLeague(key, sideMap, sideList), session.user.id);
          return (
            <Link
              key={key}
              to={`/table?league=${encodeURIComponent(key)}`}
              className="v3-glass rounded-2xl px-3 py-2.5 text-white no-underline hover:no-underline"
            >
              <span className="v3-cap">{label}</span>
              <div className="mt-1">
                <span className="v3-disp v3-num text-[28px]">
                  {place ? ordinal(place.rank) : '-'}
                </span>{' '}
                <span className="v3-num text-xs">{place ? moved(place.moved) : null}</span>
              </div>
            </Link>
          );
        })}
      </div>
      {!mySide && (
        <p className="mx-[18px] mt-2 text-xs text-[rgb(var(--v3-mut))]">
          <Link to="/account">Set the side you play for</Link> to join your side&apos;s league.
        </p>
      )}
    </div>
  );
}
