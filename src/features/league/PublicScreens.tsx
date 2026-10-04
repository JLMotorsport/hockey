import { Link } from 'react-router-dom';
import { ErrorText, Loading, PosBadge } from '@/components/ui';
import { formatDayTime, formatWeekdayTime, gameweekLabel } from '@/lib/format';
import {
  useFixtures,
  useGameweeks,
  usePlayers,
  useSeasonPoints,
  useSettings,
  useSides,
} from '@/lib/queries';
import { RULES_TABLE } from '@/lib/scoring';
import { formatPrice } from '@/lib/squad';
import { LeagueTable } from './LeagueTable';

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
  return (
    <>
      <h1>League table</h1>
      <div className="card">
        <LeagueTable />
      </div>
    </>
  );
}

export function PlayersScreen() {
  const players = usePlayers();
  const sides = useSides();
  const points = useSeasonPoints();
  if (players.isLoading || sides.isLoading || points.isLoading) return <Loading />;
  if (players.error) return <ErrorText error={players.error} />;
  const sideName = new Map((sides.data ?? []).map((s) => [s.id, s.name]));
  const list = (players.data ?? [])
    .filter((p) => p.active)
    .sort((a, b) => (points.data?.get(b.id) ?? 0) - (points.data?.get(a.id) ?? 0));

  return (
    <>
      <h1>Players</h1>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th>Side</th>
              <th className="num">Price</th>
              <th className="num">Points</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>
                  <PosBadge position={p.position} />
                </td>
                <td>{sideName.get(p.side_id)}</td>
                <td className="num">{formatPrice(p.price)}</td>
                <td className="num">{points.data?.get(p.id) ?? 0}</td>
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td colSpan={5} className="muted">
                  No players added yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function FixturesScreen() {
  const gameweeks = useGameweeks();
  const fixtures = useFixtures();
  const sides = useSides();
  if (gameweeks.isLoading || fixtures.isLoading || sides.isLoading) return <Loading />;
  if (fixtures.error) return <ErrorText error={fixtures.error} />;
  const sideName = new Map((sides.data ?? []).map((s) => [s.id, s.name]));
  const all = gameweeks.data ?? [];

  return (
    <>
      <h1>Fixtures &amp; results</h1>
      {all.map((gw) => {
        const list = (fixtures.data ?? []).filter((f) => f.gameweek_id === gw.id);
        if (!list.length) return null;
        return (
          <section key={gw.id} className="card">
            <h2>
              {gameweekLabel(gw, all)}{' '}
              <small className="muted font-normal">deadline {formatDayTime(gw.deadline)}</small>
            </h2>
            <table className="table">
              <tbody>
                {list.map((f) => (
                  <tr key={f.id}>
                    <td className="muted whitespace-nowrap">{formatWeekdayTime(f.kickoff)}</td>
                    <td>
                      <strong>{sideName.get(f.side_id)}</strong> {f.is_home ? 'v' : '@'}{' '}
                      {f.opponent}
                    </td>
                    <td className="num whitespace-nowrap">
                      {f.goals_for === null || f.goals_against === null
                        ? 'v'
                        : `${f.goals_for} - ${f.goals_against}`}
                    </td>
                    <td className="muted hidden text-xs sm:table-cell">{f.competition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      {!all.length && <p className="muted">No fixtures yet.</p>}
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
              <li>{s.squad_size} players from any Felixstowe adult side.</li>
              <li>1 goalkeeper, at least 3 defenders, 3 midfielders and 1 forward.</li>
              <li>Budget of {formatPrice(s.budget)}m.</li>
              <li>Max {s.max_per_side} players from any one side.</li>
              <li>
                Your first squad is free. After that, {s.transfers_per_gameweek} transfers per
                gameweek.
              </li>
              <li>
                Squads lock at each gameweek&apos;s deadline (usually Saturday 10:00). Your squad
                carries over each week until you change it.
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
      </div>
    </>
  );
}
