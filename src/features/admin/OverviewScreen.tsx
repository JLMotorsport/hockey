import { Link } from 'react-router-dom';
import { Loading, Stat } from '@/components/ui';
import { gameweekLabel } from '@/lib/format';
import { useFixtures, useGameweeks, useLeagueTable, usePlayers, useSides } from '@/lib/queries';

export function OverviewScreen() {
  const players = usePlayers();
  const table = useLeagueTable();
  const gameweeks = useGameweeks();
  const fixtures = useFixtures();
  const sides = useSides();
  if (players.isLoading || gameweeks.isLoading || fixtures.isLoading || sides.isLoading)
    return <Loading />;

  const all = gameweeks.data ?? [];
  const gwById = new Map(all.map((g) => [g.id, g]));
  const sideName = new Map((sides.data ?? []).map((s) => [s.id, s.name]));
  const waiting = (fixtures.data ?? []).filter(
    (f) => f.goals_for !== null && f.goals_against !== null && !f.stats_complete,
  );
  const playerCount = new Map<number, number>();
  for (const p of players.data ?? [])
    playerCount.set(p.side_id, (playerCount.get(p.side_id) ?? 0) + 1);

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat value={(players.data ?? []).filter((p) => p.active).length} label="Active players" />
        <Stat value={table.data?.length ?? 0} label="Accounts" />
        <Stat value={all.length} label="Gameweeks" />
      </div>
      <section className="card">
        <h2>Stats to enter ({waiting.length})</h2>
        <p className="muted text-sm">
          England Hockey publishes scores but not scorers or cards. Open a fixture to record who
          played and what they did.
        </p>
        <table className="table">
          <tbody>
            {waiting.map((f) => {
              const gw = gwById.get(f.gameweek_id);
              return (
                <tr key={f.id}>
                  <td className="whitespace-nowrap">{gw ? gameweekLabel(gw, all) : ''}</td>
                  <td>
                    <Link to={`/manage/fixtures/${f.id}`}>
                      {sideName.get(f.side_id)} {f.is_home ? 'v' : '@'} {f.opponent}
                    </Link>
                  </td>
                  <td className="num whitespace-nowrap">
                    {f.goals_for} - {f.goals_against}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!waiting.length && <p className="muted">All caught up.</p>}
      </section>
      <section className="card">
        <h2>Sides</h2>
        <table className="table">
          <tbody>
            {(sides.data ?? []).map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="muted">{s.competition ?? 'not synced yet'}</td>
                <td className="num">{playerCount.get(s.id) ?? 0} players</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
