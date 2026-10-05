import { Link } from 'react-router-dom';
import { Loading } from '@/components/ui';
import { formatShortDate, formatWeekdayTime, formatDayTime } from '@/lib/format';
import { isPlayed } from '@/lib/managers';
import { nextOpenGameweek, useFixtures, useGameweeks, useSides } from '@/lib/queries';
import { opponentName } from '@/lib/form';
import { PageHead, SideTag, panel } from './adminUi';
import { useManagerStatus } from './status';

interface Todo {
  count: number | string;
  title: string;
  why: string;
  action: string;
  to: string;
  colour: string;
  primary?: boolean;
}

/** "This week": a to-do list of what needs a manager, then the sync and fixtures. */
export function OverviewScreen() {
  const status = useManagerStatus();
  const gameweeks = useGameweeks();
  const fixtures = useFixtures();
  const sides = useSides();
  if (status.loading || gameweeks.isLoading) return <Loading />;

  const all = gameweeks.data ?? [];
  const next = nextOpenGameweek(all);
  const number = next ? all.filter((g) => g.start_date <= next.start_date).length : null;
  const days = next ? Math.max(0, Math.ceil((+new Date(next.deadline) - Date.now()) / 864e5)) : 0;
  const thisWeek = (fixtures.data ?? []).filter((f) => f.gameweek_id === next?.id);
  const sideList = sides.data ?? [];

  const todos: Todo[] = [];
  if (status.withheld.length)
    todos.push({
      count: status.withheld.length,
      title: 'withheld players to identify',
      why: 'Their England Hockey profile is private, so they show as "Name withheld". Pitchero sheets narrow each one to a few names.',
      action: 'Identify',
      to: '/managers/identify',
      colour: '#d91414',
      primary: true,
    });
  if (status.toPosition.length)
    todos.push({
      count: status.toPosition.length,
      title: 'players need a position',
      why: 'New from England Hockey, or still on the midfield default. Squads must be 2 GK, 5 DEF, 5 MID, 3 FWD, so wrong positions affect everyone.',
      action: 'Set positions',
      to: '/managers/players',
      colour: '#b26a00',
      primary: true,
    });
  if (status.toCheck.length)
    todos.push({
      count: status.toCheck.length,
      title: status.toCheck.length === 1 ? 'match needs checking' : 'matches need checking',
      why: 'Played, but nobody has ticked the stats as complete. Usually a missing line-up, player of the match or withheld names.',
      action: 'Open matches',
      to: '/managers/matches',
      colour: '#b26a00',
    });
  if (status.noKeeper.length)
    todos.push({
      count: status.noKeeper.length,
      title: status.noKeeper.length === 1 ? 'side has no goalkeeper' : 'sides have no goalkeeper',
      why: `${status.noKeeper.map((s) => s.short_name).join(', ')} ${status.noKeeper.length === 1 ? 'has' : 'have'} no active keeper. Every squad needs 2.`,
      action: 'Find keepers',
      to: '/managers/players',
      colour: '#b26a00',
    });
  if (status.positionSuggestions.size)
    todos.push({
      count: status.positionSuggestions.size,
      title: 'Pitchero position suggestions',
      why: 'Where players line up on Pitchero sheets. Accept, or reject to stop seeing them.',
      action: 'Review',
      to: '/managers/players?filter=suggested',
      colour: '#2a7ab0',
    });

  // Per side: matches played, the latest one, and names still withheld.
  const perSide = sideList.map((s) => {
    const played = (fixtures.data ?? []).filter((f) => f.side_id === s.id && isPlayed(f));
    const last = played
      .map((f) => f.kickoff)
      .sort()
      .at(-1);
    const sheets = played.filter((f) => f.pitchero_imported_at).length;
    const unnamed = status.withheld.filter((p) => p.side_id === s.id).length;
    return { side: s, played: played.length, last, sheets, unnamed };
  });

  return (
    <>
      <PageHead
        title="This week"
        sub={
          next
            ? `GW${number} · deadline ${formatDayTime(next.deadline)} (${days} ${days === 1 ? 'day' : 'days'}) · ${new Set(thisWeek.map((f) => f.side_id)).size} of ${sideList.length} sides playing`
            : 'No upcoming gameweek'
        }
      >
        <span className="muted hidden text-sm lg:inline">
          {todos.length ? `${todos.length} things to do` : 'Nothing to do'}
        </span>
      </PageHead>

      {todos.length ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 lg:gap-3.5">
          {todos.map((t) => (
            <TodoCard key={t.title} todo={t} />
          ))}
        </div>
      ) : (
        <p className={`${panel} p-5 font-semibold`}>All caught up. Nothing needs a manager.</p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 lg:mt-5 lg:grid-cols-[1.2fr_1fr] lg:gap-3.5">
        <section className={`${panel} p-4 lg:p-[18px]`}>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="m-0 font-display text-xl font-extrabold uppercase lg:text-[22px]">
              By side
            </h2>
            {status.lastImport && (
              <span className="muted text-right text-xs lg:text-[13px]">
                Last import {formatDayTime(status.lastImport)}
              </span>
            )}
          </div>
          {perSide.map((r) => (
            <div
              key={r.side.id}
              className="flex min-h-[40px] items-center gap-2.5 border-t border-line py-1.5 text-sm"
            >
              <SideTag>{r.side.short_name}</SideTag>
              <span className="muted flex-1">
                {r.played} played{r.last ? `, last ${formatShortDate(r.last.slice(0, 10))}` : ''}
                <span className="hidden lg:inline">
                  {' '}
                  · Pitchero {r.sheets ? `${r.sheets} sheets` : 'none'}
                </span>
              </span>
              <span
                className={`font-bold ${r.unnamed ? 'text-[#b26a00] dark:text-[#f0a640]' : 'text-[#1f7a4d] dark:text-[#5fd394]'}`}
              >
                {r.unnamed ? `${r.unnamed} withheld` : 'OK'}
              </span>
            </div>
          ))}
        </section>

        <section className={`${panel} p-4 lg:p-[18px]`}>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="m-0 font-display text-xl font-extrabold uppercase lg:text-[22px]">
              {number ? `GW${number} fixtures` : 'Fixtures'}
            </h2>
            <Link to="/managers/matches?filter=all" className="text-sm font-semibold">
              All matches
            </Link>
          </div>
          {sideList.map((s) => {
            const games = thisWeek.filter((f) => f.side_id === s.id);
            return (
              <div
                key={s.id}
                className="flex min-h-[40px] items-center gap-2.5 border-t border-line py-1.5 text-sm"
              >
                <SideTag>{s.short_name}</SideTag>
                {games.length ? (
                  <span className="flex flex-1 flex-col">
                    {games.map((f) => (
                      <span key={f.id} className="flex justify-between gap-2">
                        <span className="font-semibold">
                          {opponentName(f.opponent)} ({f.is_home ? 'H' : 'A'})
                        </span>
                        <span className="muted whitespace-nowrap">
                          {formatWeekdayTime(f.kickoff)}
                        </span>
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="muted flex-1">No game</span>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </>
  );
}

function TodoCard({ todo: t }: { todo: Todo }) {
  return (
    <>
      {/* Laptop: a card with the reason and a button. */}
      <div
        className={`${panel} hidden flex-col gap-2.5 border-t-4 p-[18px] lg:flex`}
        style={{ borderTopColor: t.colour }}
      >
        <div className="flex items-baseline gap-2.5">
          <span
            className="font-display text-[40px] font-extrabold leading-none"
            style={{ color: t.colour }}
          >
            {t.count}
          </span>
          <span className="text-base font-bold leading-tight">{t.title}</span>
        </div>
        <p className="muted m-0 flex-1 text-sm leading-snug">{t.why}</p>
        <Link
          to={t.to}
          className={`flex min-h-[40px] items-center self-start rounded-full px-3.5 font-display text-[15px] font-extrabold uppercase no-underline hover:no-underline ${t.primary ? 'bg-brand text-white hover:bg-brand-dark' : 'bg-surface text-ink ring-1 ring-line'}`}
        >
          {t.action}
        </Link>
      </div>
      {/* Phone: the whole row is the link. */}
      <Link
        to={t.to}
        className={`${panel} flex min-h-[72px] items-center gap-3 border-l-4 p-3.5 text-ink no-underline hover:no-underline lg:hidden`}
        style={{ borderLeftColor: t.colour }}
      >
        <span
          className="min-w-[48px] text-center font-display text-[32px] font-extrabold leading-none"
          style={{ color: t.colour }}
        >
          {t.count}
        </span>
        <span className="flex-1">
          <span className="block text-[15px] font-bold first-letter:uppercase">{t.title}</span>
          <span className="muted block text-[13px] leading-snug">{t.action}</span>
        </span>
        <span className="text-xl text-[#8a909b]" aria-hidden="true">
          ›
        </span>
      </Link>
    </>
  );
}
