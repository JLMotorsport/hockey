import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Sheet } from '@/components/Sheet';
import { ErrorText, Loading } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import {
  scoringGameweeks,
  useGameweeks,
  useLeagueTable,
  useProfileSides,
  useSettings,
  useSides,
} from '@/lib/queries';
import { inLeague, leagueRows, movement, type LeagueKey } from '@/lib/table';

const PODIUM = ['#ffb547', '#c9d2e3', '#d58b5b'];

/** V3 League (board "League"): pick a league, the top three on a podium, then everyone else. */
export function V3League() {
  const { session, profile } = useAuth();
  const table = useLeagueTable();
  const gameweeks = useGameweeks();
  const settings = useSettings();
  const sides = useSides();
  const sideOf = useProfileSides();
  const [params, setParams] = useSearchParams();
  const [picking, setPicking] = useState(false);
  const asked = params.get('league') ?? '';
  const league: LeagueKey = /^(all|men|women|side:\d+)$/.test(asked) ? (asked as LeagueKey) : 'all';
  if (table.isLoading || gameweeks.isLoading) return <Loading />;
  if (table.error) return <ErrorText error={table.error} />;

  const sideList = sides.data ?? [];
  const mineSide = profile?.side_id ?? null;
  const leagues: [LeagueKey, string][] = [
    ['all', 'Overall'],
    ['men', "Men's"],
    ['women', "Women's"],
    ...[...sideList]
      .sort((a, b) => Number(b.id === mineSide) - Number(a.id === mineSide))
      .map((s): [LeagueKey, string] => [
        `side:${s.id}`,
        s.id === mineSide ? `${s.short_name} (you)` : s.short_name,
      ]),
  ];
  const label = leagues.find(([k]) => k === league)?.[1] ?? 'Overall';
  const rows =
    league === 'all'
      ? (table.data ?? [])
      : leagueRows(
          table.data ?? [],
          inLeague(league, sideOf.data ?? new Map<string, number | null>(), sideList),
        );
  const moved =
    scoringGameweeks(gameweeks.data ?? [], settings.data?.scoring_from).length > 1
      ? movement(rows)
      : new Map<string, number>();
  const me = session?.user.id;
  const initials = (t: string) =>
    t
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  const top = rows.slice(0, 3);
  const podiumOrder = [top[1], top[0], top[2]];
  const arrow = (id: string) => {
    const m = moved.get(id) ?? 0;
    return m > 0 ? (
      <span className="text-[rgb(var(--v3-mint))]">▲{m}</span>
    ) : m < 0 ? (
      <span className="text-[rgb(var(--v3-red))]">▼{-m}</span>
    ) : (
      <span className="text-[rgb(var(--v3-mut))]">–</span>
    );
  };

  return (
    <div className="mx-auto max-w-[26rem]">
      <header className="flex items-center justify-between px-[18px] pb-2.5 pt-1.5">
        <span className="v3-disp text-[26px]">League</span>
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="v3-glass min-h-[40px] rounded-full px-3.5 text-[13px] font-bold"
        >
          {label} ▾
        </button>
      </header>

      {!rows.length ? (
        <p className="v3-glass mx-3.5 rounded-[20px] p-4 text-sm">Nobody in this league yet.</p>
      ) : (
        <>
          <div className="mx-3.5 mt-2 flex h-[200px] items-end justify-center gap-2.5">
            {podiumOrder.map((r, i) => {
              if (!r) return <div key={i} className="w-[104px]" />;
              const place = r.rank;
              const colour = PODIUM[place - 1] ?? '#8b94a7';
              const h = place === 1 ? 70 : place === 2 ? 44 : 30;
              const size = place === 1 ? 60 : place === 2 ? 48 : 44;
              return (
                <Link
                  key={r.user_id}
                  to={`/teams/${r.user_id}`}
                  className="v3-in flex w-[104px] flex-col items-center gap-1.5 text-white no-underline hover:no-underline"
                  style={{ animationDelay: `${(place - 1) * 90}ms` }}
                >
                  <span
                    className="flex items-center justify-center rounded-full bg-[#0d1118] text-sm font-extrabold"
                    style={{
                      width: size,
                      height: size,
                      border: `2px solid ${colour}`,
                      boxShadow: `0 0 24px -4px ${colour}`,
                    }}
                  >
                    {initials(r.team_name)}
                  </span>
                  <span className="max-w-[104px] truncate text-center text-xs font-bold">
                    {r.team_name}
                  </span>
                  <span className="v3-num text-xs text-[rgb(var(--v3-mut))]">{r.total} pts</span>
                  <span
                    className="v3-disp flex w-full justify-center rounded-t-[14px] border border-b-0 pt-1.5 text-[32px]"
                    style={{
                      height: h,
                      background: `linear-gradient(180deg, ${colour}55, transparent)`,
                      borderColor: `${colour}55`,
                    }}
                  >
                    {place}
                  </span>
                </Link>
              );
            })}
          </div>
          <ol className="v3-glass mx-3.5 mt-3 rounded-[20px] px-3.5 py-1">
            {rows.slice(3).map((r, i) => (
              <li key={r.user_id} className={i ? 'border-t border-white/[0.08]' : ''}>
                <Link
                  to={`/teams/${r.user_id}`}
                  className={`flex min-h-[54px] items-center gap-3 text-white no-underline hover:no-underline ${r.user_id === me ? '-mx-3.5 bg-[rgb(255_51_71/.1)] px-3.5' : ''}`}
                >
                  <span className="v3-disp v3-num w-7 text-[24px] text-[rgb(var(--v3-mut))]">
                    {r.rank}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold">{r.team_name}</span>
                    <span className="block truncate text-[11px] text-[rgb(var(--v3-mut))]">
                      {r.display_name}
                    </span>
                  </span>
                  <span className="v3-num text-xs">{arrow(r.user_id)}</span>
                  <span className="v3-num w-10 text-right text-[17px]">{r.total}</span>
                </Link>
              </li>
            ))}
            {rows.length <= 3 && (
              <li className="py-3 text-center text-xs text-[rgb(var(--v3-mut))]">
                That&apos;s everyone.
              </li>
            )}
          </ol>
          <p className="mx-[18px] mt-2.5 text-xs text-[rgb(var(--v3-mut))]">
            Arrows: places moved since the gameweek before. Tap a team to see their squad.
            {session && !mineSide && (
              <>
                {' '}
                <Link to="/account">Set the side you play for</Link> to join your side&apos;s
                league.
              </>
            )}
          </p>
        </>
      )}

      {picking && (
        <Sheet title="Leagues" onClose={() => setPicking(false)}>
          <ul className="divide-y divide-white/10">
            {leagues.map(([key, name]) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => {
                    setParams(key === 'all' ? {} : { league: key }, { replace: true });
                    setPicking(false);
                  }}
                  className="flex min-h-[50px] w-full items-center justify-between text-left text-[15px]"
                >
                  {name}
                  {key === league && <span className="text-[rgb(var(--v3-red))]">●</span>}
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </div>
  );
}
