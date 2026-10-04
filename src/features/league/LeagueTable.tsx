import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth/AuthProvider';
import { formatShortDate } from '@/lib/format';
import { lockedGameweeks, useGameweeks, useLeagueTable } from '@/lib/queries';
import { ErrorText, Loading } from '@/components/ui';

export function LeagueTable({ limit }: { limit?: number }) {
  const { session } = useAuth();
  const table = useLeagueTable();
  const gameweeks = useGameweeks();
  if (table.isLoading || gameweeks.isLoading) return <Loading />;
  if (table.error) return <ErrorText error={table.error} />;
  const rows = (table.data ?? []).slice(0, limit);
  if (!rows.length) return <p className="muted">No teams yet. Be the first.</p>;
  const latest = lockedGameweeks(gameweeks.data ?? []).at(-1);

  return (
    <table className="table">
      <thead>
        <tr>
          <th>#</th>
          <th>Team</th>
          <th>Manager</th>
          <th className="num">
            {latest ? `W/e ${formatShortDate(latest.start_date)}` : 'Last GW'}
          </th>
          <th className="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.user_id} className={row.user_id === session?.user.id ? 'bg-brand/10' : ''}>
            <td>{row.rank}</td>
            <td>
              <Link to={`/teams/${row.user_id}`}>{row.team_name}</Link>
            </td>
            <td>{row.display_name}</td>
            <td className="num">{row.latest}</td>
            <td className="num font-bold">{row.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
