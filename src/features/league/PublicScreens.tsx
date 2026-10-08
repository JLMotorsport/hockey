import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorText, FormBoxes, Loading, PosBadge } from '@/components/ui';
import { formatShortDate, formatWeekdayTime, gameweekLabel } from '@/lib/format';
import { fixtureLabel, opponentName, sideForm } from '@/lib/form';
import {
  nextOpenGameweek,
  useProfileSides,
  useFixtures,
  useGameweeks,
  usePlayers,
  useSettings,
  useSides,
} from '@/lib/queries';
import { CHIPS } from '@/lib/chips';
import { useAuth } from '@/lib/auth/AuthProvider';
import { inLeague, type LeagueKey } from '@/lib/table';
import { POSITIONS, RULES_TABLE, type Position } from '@/lib/scoring';
import { formatPrice } from '@/lib/squad';
import { LeagueTable } from './LeagueTable';
import { PlayerSheet } from '@/features/player/PlayerDetail';
import { StatsTable } from '@/components/StatsTable';
import { usePlayerColumns } from '@/features/player/statColumns';

export function HomeScreen() {
  return (
    <>
      <section className="hero sm:py-10">
        <img
          src="/crest.png"
          alt=""
          className="pointer-events-none absolute -right-10 -top-6 h-64 w-64 opacity-15 brightness-0 invert sm:h-80 sm:w-80"
        />
        <p className="font-display text-sm font-bold uppercase tracking-widest text-white/80">
          Felixstowe Hockey Club
        </p>
        <h1 className="mb-3 mt-1 max-w-xl text-5xl leading-[0.95] sm:text-6xl">Fantasy hockey</h1>
        <p className="max-w-lg text-white/90">
          Build an 11 from every Felixstowe side, men&apos;s and women&apos;s, 1s to 4s. Score when
          your picks score, keep clean sheets and win.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link className="btn btn-light" to="/register">
            Create your team
          </Link>
          <Link className="font-display font-bold uppercase text-white" to="/login">
            or log in
          </Link>
        </div>
      </section>
      <section className="card">
        <h2>Top of the table</h2>
        <LeagueTable limit={10} />
        <p className="mt-3">
          <Link to="/table">Full table</Link>
        </p>
      </section>
    </>
  );
}

export function TableScreen() {
  const { session, profile } = useAuth();
  const sides = useSides();
  const sideOf = useProfileSides();
  // Home's league rows open the table on that league.
  const [params] = useSearchParams();
  const [league, setLeague] = useState<LeagueKey>(() => {
    const asked = params.get('league') ?? '';
    return /^(all|men|women|side:\d+)$/.test(asked) ? (asked as LeagueKey) : 'all';
  });
  const sideList = sides.data ?? [];
  const mine = profile?.side_id ?? null;
  // Overall, Men's and Women's, then each side with your own first.
  const leagues: [LeagueKey, string][] = [
    ['all', 'Overall'],
    ['men', "Men's"],
    ['women', "Women's"],
    ...[...sideList]
      .sort((a, b) => Number(b.id === mine) - Number(a.id === mine))
      .map((s): [LeagueKey, string] => [
        `side:${s.id}`,
        s.id === mine ? `${s.short_name} (you)` : s.short_name,
      ]),
  ];
  const include =
    league === 'all'
      ? undefined
      : inLeague(league, sideOf.data ?? new Map<string, number | null>(), sideList);

  return (
    <>
      <h1>League table</h1>
      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Leagues">
        {leagues.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={league === key}
            onClick={() => setLeague(key)}
            className={`min-h-[40px] shrink-0 rounded-full px-4 font-display text-sm font-bold uppercase ${league === key ? 'bg-brand text-white' : 'bg-surface ring-1 ring-line'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="card">
        <LeagueTable include={include} />
      </div>
      <p className="muted text-sm">
        Arrows: places up or down since the gameweek before. Tap a team to see their squad.
        {session && !mine && (
          <>
            {' '}
            <Link to="/account">Set the side you play for</Link> to join the Men&apos;s or
            Women&apos;s league and your side&apos;s league.
          </>
        )}
      </p>
    </>
  );
}

export function PlayersScreen() {
  // Home's Price Changes link opens this sorted by the week's change.
  const [params] = useSearchParams();
  const sortParam = params.get('sort');
  const [open, setOpen] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<Position | ''>('');
  const [side, setSide] = useState('');
  const players = usePlayers();
  const sides = useSides();
  const fixtures = useFixtures();
  const gameweeks = useGameweeks();
  const { columns, points } = usePlayerColumns();
  if (players.isLoading || sides.isLoading) return <Loading />;
  if (players.error) return <ErrorText error={players.error} />;
  const next = nextOpenGameweek(gameweeks.data ?? []);
  const sideShort = new Map((sides.data ?? []).map((s) => [s.id, s.short_name]));
  const term = search.trim().toLowerCase();
  const list = (players.data ?? [])
    .filter((p) => p.active)
    .filter((p) => !pos || p.position === pos)
    .filter((p) => !side || String(p.side_id) === side)
    .filter((p) => !term || p.name.toLowerCase().includes(term));

  return (
    <>
      <h1>Players</h1>
      <div className="mb-3 space-y-2">
        <label className="flex min-h-[46px] items-center gap-2 rounded-xl border border-line bg-surface px-3">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5 text-ink-soft"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <span className="sr-only">Search players</span>
          <input
            type="search"
            className="min-w-0 flex-1 bg-transparent text-base outline-none"
            placeholder="Search players"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="flex items-center gap-1.5">
          <div
            className="flex flex-1 gap-1.5 overflow-x-auto"
            role="radiogroup"
            aria-label="Position"
          >
            {(['', ...POSITIONS] as const).map((p) => (
              <button
                key={p || 'all'}
                type="button"
                role="radio"
                aria-checked={pos === p}
                onClick={() => setPos(p)}
                className={`min-h-[36px] shrink-0 rounded-full px-3 font-display text-sm font-bold ${pos === p ? 'bg-[#16181d] text-white dark:bg-ink dark:text-paper' : 'bg-surface ring-1 ring-line'}`}
              >
                {p || 'All'}
              </button>
            ))}
          </div>
          <select
            className="input-inline min-h-[36px] max-w-[8rem]"
            aria-label="Side"
            value={side}
            onChange={(e) => setSide(e.target.value)}
          >
            <option value="">All sides</option>
            {(sides.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.short_name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <StatsTable
        rows={list}
        columns={columns}
        defaultSort={sortParam === 'change' ? 'change' : 'pts'}
        tiebreak={(p) => points(p.id)}
        lead={(p) => {
          const nextLabel = next ? fixtureLabel(fixtures.data ?? [], p.side_id, next.id) : null;
          return (
            <button
              type="button"
              onClick={() => setOpen(p.id)}
              className="flex min-h-[44px] w-full min-w-0 flex-col justify-center text-left"
            >
              <span className="truncate font-bold">{p.name}</span>
              <span className="muted flex min-w-0 items-center gap-1 text-xs">
                <PosBadge position={p.position} />
                <span className="truncate">
                  {sideShort.get(p.side_id)}
                  {nextLabel && ` · ${nextLabel}`}
                </span>
              </span>
            </button>
          );
        }}
      />
      {open && <PlayerSheet playerId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function FixturesScreen() {
  const gameweeks = useGameweeks();
  const fixtures = useFixtures();
  const sides = useSides();
  const [tab, setTab] = useState<'upcoming' | 'results' | null>(null);
  if (gameweeks.isLoading || fixtures.isLoading || sides.isLoading) return <Loading />;
  if (fixtures.error) return <ErrorText error={fixtures.error} />;
  const sideList = sides.data ?? [];
  const sideShort = new Map(sideList.map((s) => [s.id, s.short_name]));
  const all = gameweeks.data ?? [];
  const list = fixtures.data ?? [];
  const played = (f: (typeof list)[number]) => f.goals_for !== null && f.goals_against !== null;
  const upcoming = all.filter((gw) => list.some((f) => f.gameweek_id === gw.id && !played(f)));
  const results = all
    .filter((gw) => list.some((f) => f.gameweek_id === gw.id && played(f)))
    .reverse();
  const shown = tab ?? (upcoming.length ? 'upcoming' : 'results');
  const weeks = shown === 'upcoming' ? upcoming : results;

  return (
    <>
      <h1>Fixtures</h1>
      <section className="card !py-3">
        <h2 className="mb-2">Form</h2>
        <ul className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {sideList.map((side) => (
            <li key={side.id} className="flex items-center gap-3">
              <span className="w-9 shrink-0 rounded-md bg-[#16181d] py-0.5 text-center font-display text-sm font-bold text-white">
                {side.short_name}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{side.name}</span>
              <FormBoxes results={sideForm(list, side.id)} />
            </li>
          ))}
        </ul>
        <p className="muted mt-2 text-xs">Last 5 results, most recent on the right.</p>
      </section>
      <div className="mb-4 flex rounded-full bg-surface p-1 shadow-card" role="tablist">
        {(['upcoming', 'results'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={shown === t}
            onClick={() => setTab(t)}
            className={`min-h-[40px] flex-1 rounded-full font-display text-sm font-bold uppercase ${shown === t ? 'bg-brand text-white' : 'text-ink-soft'}`}
          >
            {t === 'upcoming' ? 'Upcoming' : 'Results'}
          </button>
        ))}
      </div>
      {weeks.map((gw) => {
        const games = list
          .filter((f) => f.gameweek_id === gw.id && (shown === 'upcoming' ? !played(f) : played(f)))
          .sort(
            (a, b) =>
              (sideList.find((s) => s.id === a.side_id)?.sort_order ?? 0) -
              (sideList.find((s) => s.id === b.side_id)?.sort_order ?? 0),
          );
        const idle = sideList.filter(
          (s) => !list.some((f) => f.gameweek_id === gw.id && f.side_id === s.id),
        );
        return (
          <section key={gw.id} className="card !p-0">
            <div className="flex items-baseline justify-between gap-2 border-b border-line px-4 py-3">
              <h2 className="m-0">
                {shown === 'upcoming'
                  ? gameweekLabel(gw, all)
                  : `${gameweekLabel(gw, all).split(' ')[0]} results`}
              </h2>
              <span className="muted text-sm">
                {shown === 'upcoming'
                  ? `Deadline ${formatWeekdayTime(gw.deadline)}`
                  : formatShortDate(gw.start_date)}
              </span>
            </div>
            <ul>
              {games.map((f) => {
                const res =
                  f.goals_for === null || f.goals_against === null
                    ? null
                    : f.goals_for > f.goals_against
                      ? 'W'
                      : f.goals_for < f.goals_against
                        ? 'L'
                        : 'D';
                return (
                  <li
                    key={f.id}
                    className="flex min-h-[52px] items-center gap-3 border-b border-line px-4 py-2 last:border-0"
                  >
                    <span className="w-9 shrink-0 rounded-md bg-[#16181d] py-0.5 text-center font-display text-sm font-bold text-white">
                      {sideShort.get(f.side_id)}
                    </span>
                    <span className="min-w-0 flex-1 font-semibold">
                      {opponentName(f.opponent)}{' '}
                      <span className="text-sm font-bold text-ink-soft">
                        {f.is_home ? 'H' : 'A'}
                      </span>
                    </span>
                    {res ? (
                      <>
                        <span className="display-num text-xl">
                          {f.goals_for}-{f.goals_against}
                        </span>
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-md font-display font-bold text-white ${res === 'W' ? 'bg-[#1f7a4d]' : res === 'L' ? 'bg-[#b3261e]' : 'bg-[#6b7280]'}`}
                          aria-label={res === 'W' ? 'Won' : res === 'L' ? 'Lost' : 'Drew'}
                        >
                          {res}
                        </span>
                      </>
                    ) : (
                      <span className="muted whitespace-nowrap text-sm tabular-nums">
                        {formatWeekdayTime(f.kickoff)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {shown === 'upcoming' && idle.length > 0 && (
              <p className="muted border-t border-line px-4 py-2 text-sm">
                No game: {idle.map((s) => s.name).join(', ')}
              </p>
            )}
          </section>
        );
      })}
      {!weeks.length && (
        <p className="muted">
          {shown === 'upcoming' ? 'No fixtures to come yet.' : 'No results yet.'}
        </p>
      )}
    </>
  );
}

export function RulesScreen() {
  const settings = useSettings();
  const s = settings.data;
  return (
    <>
      <h1>How it works</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <h2>Your squad</h2>
          {s ? (
            <ul className="list-disc space-y-1 pl-5">
              <li>
                {s.squad_size} players from any Felixstowe adult side: a starting 11 and 4 subs.
              </li>
              <li>
                Start 1 goalkeeper in a formation: {s.formations.join(', ')}{' '}
                (defenders-midfielders-forwards).
              </li>
              <li>
                Subs: a sub goalkeeper, then 3 outfield subs in order. Once the weekend is over, a
                starter who didn&apos;t play is replaced by the first sub who did, as long as the
                team still lines up in an allowed formation. Only the 11 who count score.
              </li>
              <li>Budget of {formatPrice(s.budget)}m.</li>
              <li>Max {s.max_per_side} players from any one side.</li>
              <li>
                Your first squad is free. After that, {s.transfers_per_gameweek} transfers per
                gameweek.
              </li>
              <li>
                Squads lock at each gameweek&apos;s deadline: Saturday 10:00, or an hour before a
                midweek game that week. Your squad carries over each week until you change it.
              </li>
              <li>
                If your player turns out for another Felixstowe side that weekend, those points
                count too.
              </li>
              <li>Other people&apos;s squads are revealed once the deadline passes.</li>
            </ul>
          ) : (
            <Loading />
          )}
        </section>
        <section className="card">
          <h2>Points</h2>
          <table className="table">
            <tbody>
              {RULES_TABLE.map(([label, pts]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="num">{pts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card md:col-span-2">
          <h2>Chips</h2>
          <p className="muted mb-2 text-sm">
            Play one before a gameweek&apos;s deadline from the Pick screen. One chip per gameweek,
            each once a season, apart from the wildcard: one before New Year and one after.
          </p>
          <dl className="grid gap-3 sm:grid-cols-2">
            {CHIPS.map((c) => (
              <div key={c.key}>
                <dt className="font-display text-lg font-extrabold uppercase">{c.name}</dt>
                <dd className="text-sm">{c.description}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </>
  );
}
