import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Notices, type Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { formatDayTime } from '@/lib/format';
import { requireSupabase } from '@/lib/supabase';
import { useManagerStatus } from './status';

interface SyncResult {
  side: string;
  ok: boolean;
  message: string;
}

interface NavItem {
  to: string;
  label: string;
  short: string;
  count?: number;
  urgent?: boolean;
}

/**
 * The managers' area, at /managers: its own dark header and menu, away from
 * the fantasy game. A sidebar on a laptop, a strip of tabs on a phone. (The
 * database is the real boundary; this only keeps the screens apart.)
 */
export function AdminLayout() {
  const { profile, loading } = useAuth();
  const queryClient = useQueryClient();
  const status = useManagerStatus();
  const [syncing, setSyncing] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);

  async function sync() {
    setSyncing(true);
    const result = await requireSupabase().functions.invoke<{ results: SyncResult[] }>('eh-sync');
    setSyncing(false);
    if (result.error) {
      const message = result.error instanceof Error ? result.error.message : 'unknown error';
      setNotices([{ kind: 'error', text: `Sync failed: ${message}` }]);
      return;
    }
    const results = result.data?.results ?? [];
    const failed = results.filter((r) => !r.ok);
    setNotices(
      failed.length
        ? failed.map((r) => ({ kind: 'error', text: `${r.side}: sync failed (${r.message})` }))
        : [{ kind: 'success', text: `Synced ${results.length} sides from England Hockey.` }],
    );
    await queryClient.invalidateQueries();
  }

  const nav: NavItem[] = [
    { to: '/managers', label: 'Overview', short: 'Overview' },
    { to: '/managers/matches', label: 'Matches', short: 'Matches', count: status.toCheck.length },
    {
      to: '/managers/players',
      label: 'Players',
      short: 'Players',
      count: status.toPosition.length,
    },
    {
      to: '/managers/identify',
      label: 'Identify players',
      short: 'Identify',
      count: status.withheld.length,
      urgent: true,
    },
    { to: '/managers/gameweeks', label: 'Gameweeks', short: 'Gameweeks' },
    { to: '/managers/users', label: 'Users', short: 'Users' },
    { to: '/managers/settings', label: 'Settings', short: 'Settings' },
  ];
  const synced = status.lastImport ? `Last import ${formatDayTime(status.lastImport)}` : '';
  const isAdmin = Boolean(profile?.is_admin);

  return (
    <div className="min-h-screen bg-[#f4f5f7]">
      <header className="sticky top-0 z-30 bg-[#16181d] text-white shadow-md">
        <div className="mx-auto flex max-w-[1320px] items-center gap-3 py-2.5 pl-4 pr-2 lg:px-7">
          <Link
            to="/managers"
            className="flex min-w-0 flex-1 items-center gap-2.5 text-white no-underline hover:no-underline lg:flex-none"
          >
            <img src="/crest.png" alt="" className="h-8 w-8 brightness-0 invert lg:h-9 lg:w-9" />
            <span className="font-display leading-none">
              <span className="block text-[17px] font-extrabold uppercase lg:text-[19px]">
                Fantasy Hockey
              </span>
              <span className="block text-[11px] font-bold uppercase tracking-[0.2em] text-[#ff8a8a] lg:text-xs">
                Managers
              </span>
            </span>
          </Link>
          <div className="hidden flex-1 lg:block" />
          {isAdmin && synced && (
            <span className="hidden items-center gap-2 text-[13px] text-white/80 lg:flex">
              <span className="h-2 w-2 rounded-full bg-[#3ecf8e]" />
              {synced}
            </span>
          )}
          {isAdmin && (
            <button
              type="button"
              className="min-h-tap rounded-full bg-brand px-4 font-display text-sm font-extrabold uppercase text-white disabled:opacity-60 lg:min-h-[38px] lg:text-[15px]"
              disabled={syncing}
              onClick={() => void sync()}
            >
              {syncing ? (
                'Syncing'
              ) : (
                <>
                  <span className="lg:hidden">Sync</span>
                  <span className="hidden lg:inline">Sync now</span>
                </>
              )}
            </button>
          )}
          <Link
            to="/dashboard"
            aria-label="Back to the game"
            className="flex min-h-tap min-w-tap items-center justify-center font-display text-sm font-bold uppercase text-white/80 no-underline hover:text-white hover:no-underline lg:px-2"
          >
            <span className="text-2xl leading-none lg:hidden" aria-hidden="true">
              ×
            </span>
            <span className="hidden lg:inline">Back to the game</span>
          </Link>
        </div>
        {isAdmin && synced && (
          <p className="flex items-center gap-2 px-4 pb-1 text-xs text-white/75 lg:hidden">
            <span className="h-2 w-2 rounded-full bg-[#3ecf8e]" />
            {synced}
          </p>
        )}
        {/* Phones: the menu as a strip of tabs under the header. */}
        {isAdmin && (
          <nav className="flex gap-1 overflow-x-auto px-2 lg:hidden" aria-label="Managers">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/managers'}
                ref={(el) => {
                  if (el?.classList.contains('active'))
                    el.scrollIntoView({ inline: 'center', block: 'nearest' });
                }}
                className={({ isActive }) =>
                  `flex min-h-tap shrink-0 items-center gap-1.5 border-b-[3px] px-2.5 font-display text-[15px] font-extrabold uppercase no-underline hover:no-underline ${isActive ? 'active border-brand text-white' : 'border-transparent text-white/60'}`
                }
              >
                {n.short}
                <Badge item={n} />
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      {loading ? (
        <p className="muted mx-auto max-w-6xl px-4 py-6">Loading...</p>
      ) : !isAdmin ? (
        <div className="card mx-auto mt-6 max-w-md">
          <h1 className="mt-0">Managers only</h1>
          <p>This area is for league managers.</p>
          <Link to="/dashboard">Back to the game</Link>
        </div>
      ) : (
        <div className="mx-auto flex max-w-[1320px] gap-4 lg:pr-7">
          {/* Laptops: a menu down the side. */}
          <nav className="hidden w-[220px] shrink-0 px-3 py-5 lg:block" aria-label="Managers">
            <ul className="sticky top-20 space-y-1">
              {nav.map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    end={n.to === '/managers'}
                    className={({ isActive }) =>
                      `flex min-h-tap items-center justify-between rounded-[10px] px-3 font-display text-base font-extrabold uppercase no-underline hover:bg-surface hover:no-underline ${isActive ? 'bg-surface text-brand shadow-card' : 'text-ink-soft'}`
                    }
                  >
                    {n.label}
                    <Badge item={n} />
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <main className="min-w-0 flex-1 px-4 pb-24 pt-4 lg:px-0 lg:pt-6">
            <Notices items={notices} />
            <Outlet />
          </main>
        </div>
      )}
    </div>
  );
}

function Badge({ item }: { item: NavItem }) {
  if (!item.count) return null;
  return (
    <span
      className={`flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 font-sans text-[11px] font-bold text-white ${item.urgent ? 'bg-brand' : 'bg-[#b26a00]'}`}
    >
      {item.count}
    </span>
  );
}

const MOVED: [RegExp, string][] = [
  [/^\/managers\/fixtures/, '/managers/matches'],
  [/^\/managers\/deadlines/, '/managers/gameweeks'],
  [/^\/managers\/sides/, '/managers/settings'],
];

/** Old /manage links (bookmarks) and renamed pages go to their new home. */
export function ManageRedirect() {
  const { pathname, search } = useLocation();
  let to = pathname.replace(/^\/manage(rs)?/, '/managers');
  for (const [from, into] of MOVED) to = to.replace(from, into);
  return <Navigate to={to + search} replace />;
}
