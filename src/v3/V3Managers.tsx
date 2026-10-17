import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Loading, Notices } from '@/components/ui';
import { useManagerStatus } from '@/features/admin/status';
import { useEhSync } from '@/features/admin/useEhSync';
import { useAuth } from '@/lib/auth/AuthProvider';
import { formatDayTime, formatWeekdayTime } from '@/lib/format';
import { opponentName } from '@/lib/form';
import { nextAfterGameSync } from '@/lib/managers';
import { nextOpenGameweek, useFixtures, useGameweeks, useSides } from '@/lib/queries';
import { useTransitionClick } from '@/lib/navTransition';
import { BackBar } from './V3Bits';

interface Tile {
  count: number;
  title: string;
  /** Under the count: who or what, or "All OK". */
  detail: string;
  /** Where it opens; none for sync errors (listed in the sync card). */
  to?: string;
  urgent?: boolean;
}

/** V3 managers' overview (board "Managers"): what needs a manager, the sync, then every page. */
export function V3Managers() {
  const { profile, loading } = useAuth();
  const status = useManagerStatus();
  const gameweeks = useGameweeks();
  const fixtures = useFixtures();
  const sides = useSides();
  const { syncing, notices, sync } = useEhSync();
  const click = useTransitionClick();

  const header = (sub: string, right?: ReactNode) => (
    <BackBar to="/more" right={right}>
      <span className="v3-cap block">{sub}</span>
      <span className="v3-disp text-[26px]">Managers</span>
    </BackBar>
  );

  if (loading || status.loading || gameweeks.isLoading) return <Loading />;
  if (!profile?.is_admin && !profile?.is_super) {
    return (
      <div className="mx-auto max-w-[26rem]">
        {header('Felixstowe HC')}
        <p className="v3-glass mx-3.5 rounded-[20px] p-4 text-sm">
          This area is for league managers.
        </p>
      </div>
    );
  }

  const all = gameweeks.data ?? [];
  const next = nextOpenGameweek(all);
  const number = next ? all.filter((g) => g.start_date <= next.start_date).length : null;
  const sideShort = new Map((sides.data ?? []).map((s) => [s.id, s.short_name]));
  const names = (list: { short_name: string }[]) => list.map((s) => s.short_name).join(', ');
  const withheldSides = [
    ...new Set(status.withheld.map((p) => sideShort.get(p.side_id)).filter(Boolean)),
  ].join(', ');

  const sidesOf = (list: { side_id: number }[]) =>
    [...new Set(list.map((f) => sideShort.get(f.side_id)).filter(Boolean))].join(', ');
  const tiles: Tile[] = [
    {
      count: status.toCheck.length,
      title: status.toCheck.length === 1 ? 'Match to check' : 'Matches to check',
      detail: status.toCheck.length ? sidesOf(status.toCheck) : 'All checked',
      to: '/managers/matches',
    },
    {
      count: status.needPotm.length,
      title: 'Need a POTM',
      detail: status.needPotm.length ? sidesOf(status.needPotm) : 'All have one',
      to: '/managers/matches',
    },
    {
      count: status.withheld.length,
      title: 'Withheld names',
      detail: withheldSides || 'All named',
      to: '/managers/identify',
      urgent: true,
    },
    {
      count: status.syncErrors.length,
      title: status.syncErrors.length === 1 ? 'Sync error' : 'Sync errors',
      detail: status.syncErrors.length
        ? status.syncErrors.map((r) => sideShort.get(r.side_id ?? 0) ?? r.source).join(', ')
        : 'All sides OK',
      urgent: true,
    },
    {
      count: status.toPosition.length,
      title: 'Need a position',
      detail: status.toPosition.length ? 'Set positions' : 'All set',
      to: '/managers/players',
    },
    {
      count: status.noKeeper.length,
      title: status.noKeeper.length === 1 ? 'Side, no keeper' : 'Sides, no keeper',
      detail: status.noKeeper.length ? names(status.noKeeper) : 'All have one',
      to: '/managers/players',
    },
  ];
  const todo = tiles.filter((t) => t.count > 0).length + (status.positionSuggestions.size ? 1 : 0);
  const due = nextAfterGameSync(fixtures.data ?? []);
  const lastSync = status.lastSync ?? status.lastImport;

  const pages: [string, string][] = [
    ['/managers/matches', 'Matches'],
    ['/managers/players', 'Players and prices'],
    ['/managers/identify', 'Identify withheld players'],
    ['/managers/gameweeks', 'Gameweeks and deadlines'],
    ['/managers/users', 'Users'],
    ['/managers/settings', 'Settings'],
  ];

  return (
    <div className="mx-auto max-w-[26rem] pb-6">
      {header(
        next ? `GW${number} · deadline ${formatWeekdayTime(next.deadline)}` : 'Felixstowe HC',
        <span
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${todo ? 'border-[rgb(255_181_71/.35)] bg-[rgb(255_181_71/.12)] text-[rgb(var(--v3-amber))]' : 'border-[rgb(63_242_168/.35)] bg-[rgb(63_242_168/.12)] text-[rgb(var(--v3-mint))]'}`}
        >
          {todo ? `${todo} to do` : 'All done'}
        </span>,
      )}

      <div className="grid grid-cols-2 gap-2.5 px-3.5">
        {tiles.map((t) => {
          const colour = t.count ? (t.urgent ? '--v3-red' : '--v3-amber') : '--v3-mint';
          const body = (
            <>
              <span
                className="v3-disp v3-num text-[44px] leading-none"
                style={{ color: `rgb(var(${colour}))` }}
              >
                {t.count}
              </span>
              <span className="mt-1.5 text-xs font-semibold">{t.title}</span>
              <span className="mt-auto truncate pt-1 text-[11px] text-[rgb(var(--v3-mut))]">
                {t.detail}
              </span>
            </>
          );
          const box =
            'v3-glass flex min-h-[112px] flex-col rounded-[20px] p-3.5 text-white no-underline hover:no-underline';
          const edge = t.count ? { borderColor: `rgb(var(${colour}) / .35)` } : undefined;
          return t.to ? (
            <Link
              key={t.title}
              to={t.to}
              onClick={click(t.to, 'forward')}
              className={box}
              style={edge}
            >
              {body}
            </Link>
          ) : (
            <div key={t.title} className={box} style={edge}>
              {body}
            </div>
          );
        })}
      </div>

      {status.positionSuggestions.size > 0 && (
        <Link
          to="/managers/players?filter=suggested"
          onClick={click('/managers/players?filter=suggested', 'forward')}
          className="v3-glass mx-3.5 mt-2.5 flex min-h-[56px] items-center gap-3 rounded-[20px] px-3.5 text-white no-underline hover:no-underline"
        >
          <span className="v3-disp v3-num text-2xl text-[rgb(var(--v3-cyan))]">
            {status.positionSuggestions.size}
          </span>
          <span className="flex-1 text-[13px]">Pitchero position suggestions to review</span>
          <span className="text-[rgb(var(--v3-mut))]">›</span>
        </Link>
      )}

      <div className="mx-3.5 mt-2.5">
        <Notices items={notices} />
      </div>
      <div className="v3-glass mx-3.5 mt-2.5 flex items-center gap-3 rounded-[20px] p-3.5">
        <span className="min-w-0 flex-1">
          <span className="v3-cap block">England Hockey sync</span>
          <span className="block text-sm font-bold">
            {lastSync ? `Last: ${formatDayTime(lastSync)}` : 'Nothing synced yet'}
          </span>
          <span className="block text-[11px] leading-snug text-[rgb(var(--v3-mut))]">
            {due
              ? `Next: after ${sideShort.get(due.fixture.side_id) ?? ''} v ${opponentName(due.fixture.opponent)}, ${formatWeekdayTime(due.at.toISOString())}`
              : 'Next: the weekend safety syncs (Sat 20:00, Sun 17:00, Mon 09:00)'}
          </span>
        </span>
        <button
          type="button"
          disabled={syncing}
          onClick={() => void sync()}
          className="v3-btn v3-red v3-glow min-h-[44px] shrink-0 px-[18px] disabled:opacity-60"
        >
          {syncing ? 'Syncing' : 'Sync now'}
        </button>
      </div>

      {status.syncErrors.length > 0 && (
        <ul className="mx-3.5 mt-2 flex flex-col gap-1.5">
          {status.syncErrors.map((r) => (
            <li
              key={r.source}
              className="rounded-[14px] border border-[rgb(255_51_71/.35)] bg-[rgb(255_51_71/.1)] px-3 py-2 text-xs leading-snug"
            >
              <b>{r.source}</b> failed {formatDayTime(r.synced_at)}
              {r.last_ok_at ? ` (last worked ${formatDayTime(r.last_ok_at)})` : ''}:{' '}
              <span className="text-[#ffb3bb]">{r.message}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="v3-cap mx-[18px] mb-2 mt-4">Jump to</div>
      <div className="v3-glass mx-3.5 divide-y divide-white/10 rounded-[20px] px-3.5">
        {pages.map(([to, label]) => (
          <Link
            key={to}
            to={to}
            onClick={click(to, 'forward')}
            className="flex min-h-[52px] items-center justify-between text-[15px] text-white no-underline hover:no-underline"
          >
            {label}
            <span className="text-[rgb(var(--v3-mut))]">›</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
