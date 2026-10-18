import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorText, Loading } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { gameweekLabel } from '@/lib/format';
import { bestGameweek, monthsOf, monthTable } from '@/lib/month';
import {
  useGameweeks,
  useLeaguePoints,
  useLeagueTable,
  useProfileSides,
  useSettings,
  useSides,
} from '@/lib/queries';
import { canShareFiles, renderCard, SOCIAL } from '@/lib/shareImage';

/** Settled: two days after a gameweek starts its scores are final (as auto-subs). */
const settled = (startDate: string, now = new Date()) =>
  new Date(`${startDate}T00:00:00Z`).getTime() + 2 * 86_400_000 <= now.getTime();

/**
 * Manager of the Month: the month's points (its gameweeks so far), ranked,
 * with the month's leader and a club card to share once it's decided.
 */
export function MonthView({ include }: { include?: (userId: string) => boolean }) {
  const { session } = useAuth();
  const table = useLeagueTable();
  const points = useLeaguePoints();
  const gameweeks = useGameweeks();
  const settings = useSettings();
  const sides = useSides();
  const sideOf = useProfileSides();
  const all = gameweeks.data ?? [];
  const months = monthsOf(all, settings.data?.scoring_from);
  const now = new Date();
  const lockedIds = new Set(all.filter((g) => new Date(g.deadline) <= now).map((g) => g.id));
  // The month with the latest gameweek played, else the first to come.
  const current = months.reduce(
    (at, m, i) => (m.gameweeks.some((g) => lockedIds.has(g.id)) ? i : at),
    0,
  );
  const [picked, setPicked] = useState<number | null>(null);
  const index = Math.min(picked ?? current, Math.max(0, months.length - 1));
  const card = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  if (table.isLoading || points.isLoading || gameweeks.isLoading) return <Loading />;
  if (table.error) return <ErrorText error={table.error} />;
  const month = months[index];
  if (!month) return <p className="muted">No gameweeks yet.</p>;

  const number = (id: number) => {
    const g = all.find((x) => x.id === id);
    return g ? gameweekLabel(g, all).split(' ')[0] : '';
  };
  const played = month.gameweeks.filter((g) => lockedIds.has(g.id)).map((g) => g.id);
  const last = month.gameweeks.at(-1)!;
  const decided = played.length === month.gameweeks.length && settled(last.start_date, now);
  const managers = (table.data ?? []).filter((r) => !include || include(r.user_id));
  const rows = monthTable(managers, points.data ?? new Map<string, Map<number, number>>(), played);
  const leader = played.length ? rows[0] : undefined;
  const best = bestGameweek(
    managers,
    points.data ?? new Map<string, Map<number, number>>(),
    played,
  );
  const sideShort = (userId: string) =>
    sides.data?.find((s) => s.id === sideOf.data?.get(userId))?.short_name;

  async function share() {
    if (!card.current) return;
    setBusy(true);
    try {
      const blob = await renderCard(card.current);
      const file = new File([blob], `fhc-manager-of-the-month-${month!.key}.png`, {
        type: 'image/png',
      });
      if (canShareFiles()) {
        await navigator.share({
          files: [file],
          title: `FHC Manager of the Month, ${month!.label}`,
        });
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(file);
        link.download = file.name;
        link.click();
        URL.revokeObjectURL(link.href);
      }
    } catch {
      // Closing the share sheet is fine.
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card !px-3 !pt-1">
        {/* Month picker: each calendar month's gameweeks. */}
        <div className="flex min-h-[52px] items-center gap-2 border-b border-line">
          <button
            type="button"
            aria-label="Previous month"
            disabled={index <= 0}
            onClick={() => setPicked(index - 1)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-xl disabled:opacity-30 dark:bg-[#1f232c]"
          >
            ‹
          </button>
          <span className="flex flex-1 flex-col text-center leading-tight">
            <span className="font-display text-xl font-extrabold uppercase">{month.label}</span>
            <span className="muted text-xs">
              {number(month.gameweeks[0]!.id)}
              {month.gameweeks.length > 1 ? ` to ${number(last.id)}` : ''} · {played.length} of{' '}
              {month.gameweeks.length} played
            </span>
          </span>
          <button
            type="button"
            aria-label="Next month"
            disabled={index >= months.length - 1}
            onClick={() => setPicked(index + 1)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-xl disabled:opacity-30 dark:bg-[#1f232c]"
          >
            ›
          </button>
        </div>
        {!played.length ? (
          <p className="muted my-4 text-center">No gameweeks played this month yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-[2.75rem_1fr_3.5rem] items-center px-1 pb-2 pt-2 font-display text-xs font-bold uppercase tracking-wide text-ink-soft">
              <span>Pos</span>
              <span>Team</span>
              <span className="text-right">Month</span>
            </div>
            <ol>
              {rows.map((row) => (
                <li key={row.user_id}>
                  <Link
                    to={`/teams/${row.user_id}`}
                    className={`grid min-h-[56px] grid-cols-[2.75rem_1fr_3.5rem] items-center border-t border-line px-1 text-ink no-underline hover:no-underline ${row.user_id === session?.user.id ? 'bg-brand/10' : ''}`}
                  >
                    <span className="flex items-center gap-1">
                      <span className="display-num text-xl">{row.rank}</span>
                      {played.length > 1 && (
                        <span
                          className={`text-[0.7rem] font-bold ${row.move > 0 ? 'text-[#1f7a4d] dark:text-[#5fd39a]' : row.move < 0 ? 'text-[#b3261e] dark:text-[#ff8a80]' : 'text-ink-soft'}`}
                        >
                          {row.move > 0 ? `▲${row.move}` : row.move < 0 ? `▼${-row.move}` : '–'}
                        </span>
                      )}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-bold">{row.team_name}</span>
                      <span className="muted truncate text-sm">{row.display_name}</span>
                    </span>
                    <span className="display-num text-right text-xl">{row.points}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      {leader && (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-[#f2c27a] bg-[#fff4e5] px-3 py-2 text-sm text-[#6b3d00] dark:border-[#7a5a24] dark:bg-[#2a2210] dark:text-[#f5d9a8]">
          <span className="flex-1 leading-snug">
            {decided ? (
              <>
                <b>Manager of the Month:</b> {leader.team_name}, {leader.points} pts.
              </>
            ) : (
              <>
                <b>Manager of the Month</b> is decided after {number(last.id)}. Leader so far:{' '}
                {leader.team_name}.
              </>
            )}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void share()}
            className="min-h-tap shrink-0 rounded-full bg-[#14181f] px-4 font-extrabold text-white disabled:opacity-60 dark:bg-[#eceff4] dark:text-[#0e1014]"
          >
            {busy ? 'Making' : 'Share'}
          </button>
        </div>
      )}

      {leader && (
        // The card for socials (4:5, as Team of the Week's), drawn off screen.
        <div aria-hidden="true" className="pointer-events-none fixed left-[-10000px] top-0">
          <div
            ref={card}
            className="no-shadow flex flex-col overflow-hidden bg-[#d91414] text-white"
            style={SOCIAL}
          >
            <div className="flex items-center gap-4 px-6 pb-3 pt-6">
              <img src="/crest.png" alt="" className="h-16 w-16 brightness-0 invert" />
              <div className="font-display uppercase leading-none">
                <p className="text-sm font-bold tracking-widest text-white/80">
                  Felixstowe HC Fantasy
                </p>
                <p className="text-[2.6rem] font-extrabold">Manager of the Month</p>
                <p className="mt-1 text-lg font-bold text-white/90">
                  {month.label} · {number(month.gameweeks[0]!.id)}
                  {month.gameweeks.length > 1 ? ` to ${number(last.id)}` : ''}
                </p>
              </div>
            </div>
            <div className="mx-6 mt-2 flex items-center gap-4 rounded-2xl bg-black/20 px-5 py-5">
              <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[#ffd400] text-[#14181f]">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-11 w-11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" />
                </svg>
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-display text-[2rem] font-extrabold uppercase leading-none">
                  {leader.team_name}
                </span>
                <span className="text-lg text-white/90">
                  {leader.display_name}
                  {sideShort(leader.user_id) ? ` · plays for ${sideShort(leader.user_id)}` : ''}
                </span>
              </span>
              <span className="text-right font-display uppercase leading-none">
                <span className="display-num block text-6xl">{leader.points}</span>
                <span className="text-sm text-white/85">pts</span>
              </span>
            </div>
            <div className="mx-6 mt-3">
              {rows.slice(1, 5).map((r) => (
                <div
                  key={r.user_id}
                  className="flex min-h-[3.1rem] items-center gap-3 border-b border-white/25 text-xl"
                >
                  <span className="display-num w-8 text-white/85">{r.rank}</span>
                  <span className="min-w-0 flex-1 truncate font-bold">{r.team_name}</span>
                  <span className="display-num">{r.points}</span>
                </div>
              ))}
            </div>
            {best && (
              <div className="mt-auto flex justify-between bg-[#16181d] px-6 py-3 font-display text-base font-bold uppercase tracking-wide">
                <span className="text-white/75">Highest gameweek</span>
                <span>
                  {best.manager.team_name} · {best.points} ({number(best.gameweekId)})
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
