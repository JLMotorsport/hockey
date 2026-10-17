import { useState } from 'react';
import { ErrorText, Loading } from '@/components/ui';
import { formatShortDate, formatWeekdayTime, gameweekLabel } from '@/lib/format';
import { opponentName, sideForm } from '@/lib/form';
import { MatchSheet } from '@/features/league/MatchSheet';
import { useFixtures, useGameweeks, useSides } from '@/lib/queries';

const RESULT_COLOUR = { W: '--v3-mint', L: '--v3-red', D: '--v3-amber' } as const;
const RESULT_WORD = { W: 'Won', L: 'Lost', D: 'Drew' } as const;

/** V3 Fixtures (board "Fixtures"): each side's form, then the week's games or the results. */
export function V3Fixtures() {
  const gameweeks = useGameweeks();
  const fixtures = useFixtures();
  const sides = useSides();
  const [tab, setTab] = useState<'upcoming' | 'results' | null>(null);
  const [match, setMatch] = useState<number | null>(null);
  if (gameweeks.isLoading || fixtures.isLoading || sides.isLoading) return <Loading />;
  if (fixtures.error) return <ErrorText error={fixtures.error} />;

  const sideList = sides.data ?? [];
  const sideShort = new Map(sideList.map((s) => [s.id, s.short_name]));
  const order = new Map(sideList.map((s) => [s.id, s.sort_order]));
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
    <div className="mx-auto max-w-[26rem] pb-4">
      <header className="flex items-center justify-between gap-3 px-[18px] pb-2.5 pt-1.5">
        <span className="v3-disp text-[26px]">Fixtures</span>
        <div
          role="tablist"
          className="flex rounded-[14px] border border-white/10 bg-white/[0.06] p-[3px]"
        >
          {(['upcoming', 'results'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={shown === t}
              onClick={() => setTab(t)}
              className={`v3-disp min-h-[40px] rounded-[11px] px-4 text-sm ${shown === t ? 'bg-white text-[#05070c]' : 'text-[rgb(var(--v3-mut))]'}`}
            >
              {t === 'upcoming' ? 'Week' : 'Results'}
            </button>
          ))}
        </div>
      </header>

      <div className="v3-cap mx-[18px] mb-2 mt-1">Form · last 5</div>
      <div className="flex gap-2 overflow-x-auto px-3.5 pb-1 [scrollbar-width:none]">
        {sideList.map((side) => (
          <div
            key={side.id}
            className="v3-glass flex shrink-0 flex-col items-center gap-1.5 rounded-2xl px-2.5 py-2"
          >
            <span className="v3-disp text-[15px]">{side.short_name}</span>
            <span className="flex gap-[3px]">
              {sideForm(list, side.id).map((r, i) => (
                <span
                  key={i}
                  aria-label={RESULT_WORD[r]}
                  className="h-2 w-2 rounded-full"
                  style={{ background: `rgb(var(${RESULT_COLOUR[r]}))` }}
                />
              ))}
              {sideForm(list, side.id).length === 0 && (
                <span className="text-[10px] text-[rgb(var(--v3-mut))]">No games</span>
              )}
            </span>
          </div>
        ))}
      </div>

      {weeks.map((gw) => {
        const games = list
          .filter((f) => f.gameweek_id === gw.id && (shown === 'upcoming' ? !played(f) : played(f)))
          .sort((a, b) => (order.get(a.side_id) ?? 0) - (order.get(b.side_id) ?? 0));
        const idle = sideList.filter(
          (s) => !list.some((f) => f.gameweek_id === gw.id && f.side_id === s.id),
        );
        return (
          <section key={gw.id}>
            <div className="mx-[18px] mb-2 mt-4 flex items-baseline justify-between gap-2">
              <span className="v3-cap">
                {shown === 'upcoming'
                  ? gameweekLabel(gw, all)
                  : `${gameweekLabel(gw, all).split(' ')[0]} results`}
              </span>
              <span className="text-[11px] text-[rgb(var(--v3-mut))]">
                {shown === 'upcoming'
                  ? `Deadline ${formatWeekdayTime(gw.deadline)}`
                  : formatShortDate(gw.start_date)}
              </span>
            </div>
            <ul className="px-3.5">
              {games.map((f, i) => {
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
                    className="v3-in border-b border-white/10"
                    style={{ animationDelay: `${i * 0.04}s` }}
                  >
                    <button
                      type="button"
                      disabled={!res}
                      onClick={() => setMatch(f.id)}
                      className="flex min-h-[56px] w-full items-center gap-3 py-2 text-left disabled:cursor-default"
                    >
                      <span className="v3-disp flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-[15px]">
                        {sideShort.get(f.side_id)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">
                          {opponentName(f.opponent)}
                        </span>
                        <span className="block text-[11px] text-[rgb(var(--v3-mut))]">
                          {f.is_home ? 'Home' : 'Away'}
                          {res
                            ? f.lineup_imported_at || f.stats_locked
                              ? ' · Points in'
                              : ' · Waiting for line-up'
                            : ''}
                        </span>
                      </span>
                      {res ? (
                        <>
                          <span className="v3-disp v3-num text-2xl">
                            {f.goals_for}-{f.goals_against}
                          </span>
                          <span
                            aria-label={RESULT_WORD[res]}
                            className="v3-disp flex h-[26px] w-[26px] items-center justify-center rounded-[9px] border text-sm"
                            style={{
                              color: `rgb(var(${RESULT_COLOUR[res]}))`,
                              borderColor: `rgb(var(${RESULT_COLOUR[res]}))`,
                              background: `rgb(var(${RESULT_COLOUR[res]}) / .13)`,
                            }}
                          >
                            {res}
                          </span>
                        </>
                      ) : (
                        <span className="v3-num whitespace-nowrap text-[13px] text-[rgb(var(--v3-mut))]">
                          {formatWeekdayTime(f.kickoff)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {shown === 'upcoming' && idle.length > 0 && (
              <p className="mx-[18px] mt-2 text-xs text-[rgb(var(--v3-mut))]">
                No game: {idle.map((s) => s.name).join(', ')}
              </p>
            )}
          </section>
        );
      })}
      {!weeks.length && (
        <p className="v3-glass mx-3.5 mt-4 rounded-[20px] p-4 text-sm">
          {shown === 'upcoming' ? 'No fixtures to come yet.' : 'No results yet.'}
        </p>
      )}
      {match !== null && <MatchSheet fixtureId={match} onClose={() => setMatch(null)} />}
    </div>
  );
}
