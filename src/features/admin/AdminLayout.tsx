import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Notices, type Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { requireSupabase } from '@/lib/supabase';

const LINKS: [string, string][] = [
  ['/managers', 'Overview'],
  ['/managers/fixtures', 'Matches & stats'],
  ['/managers/players', 'Players'],
  ['/managers/deadlines', 'Deadlines'],
  ['/managers/sides', 'Sides'],
  ['/managers/users', 'Users'],
  ['/managers/settings', 'Settings'],
];

interface SyncResult {
  side: string;
  ok: boolean;
  message: string;
}

/**
 * The managers' area, at /managers: its own dark header and menu, laid out
 * for a laptop, away from the fantasy game. (The database is the real
 * boundary; this only keeps the screens apart.)
 */
export function AdminLayout() {
  const { profile, loading } = useAuth();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);

  async function sync() {
    setSyncing(true);
    const result = await requireSupabase().functions.invoke<{ results: SyncResult[] }>('eh-sync');
    setSyncing(false);
    const data = result.data;
    if (result.error) {
      const message = result.error instanceof Error ? result.error.message : 'unknown error';
      setNotices([{ kind: 'error', text: `Sync failed: ${message}` }]);
      return;
    }
    setNotices(
      (data?.results ?? []).map((r) => ({
        kind: r.ok ? 'success' : 'error',
        text: `${r.side}: ${r.ok ? r.message : `sync failed (${r.message})`}`,
      })),
    );
    await queryClient.invalidateQueries();
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-30 bg-[#16181d] text-white shadow-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Link
            to="/managers"
            className="flex items-center gap-2.5 text-white no-underline hover:no-underline"
          >
            <img src="/crest.png" alt="" className="h-9 w-9 brightness-0 invert" />
            <span className="font-display leading-none">
              <span className="hidden text-lg font-extrabold uppercase tracking-tight sm:block">
                Fantasy Hockey
              </span>
              <span className="block text-lg font-extrabold uppercase tracking-widest text-[#ff8a8a] sm:text-xs sm:font-bold">
                Managers
              </span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {profile?.is_admin && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={syncing}
                onClick={() => void sync()}
              >
                {syncing ? 'Syncing' : 'Sync'}
                <span className="hidden sm:inline">&nbsp;from England Hockey</span>
              </button>
            )}
            <Link
              to="/dashboard"
              className="rounded-full px-3 py-1.5 font-display text-sm font-bold uppercase text-white/80 no-underline hover:text-white hover:no-underline"
            >
              <span className="sm:hidden">Game</span>
              <span className="hidden sm:inline">Back to the game</span>
            </Link>
          </div>
        </div>
        {/* Phones: the menu as a strip under the header. */}
        {profile?.is_admin && (
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2 lg:hidden" aria-label="Managers">
            {LINKS.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/managers'}
                className={({ isActive }) =>
                  `shrink-0 rounded-full px-3 py-1.5 font-display text-sm font-bold uppercase no-underline hover:no-underline ${isActive ? 'bg-white text-[#16181d]' : 'text-white/80'}`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      {loading ? (
        <p className="muted mx-auto max-w-6xl px-4 py-6">Loading...</p>
      ) : !profile?.is_admin ? (
        <div className="card mx-auto mt-6 max-w-md">
          <h1 className="mt-0">Managers only</h1>
          <p>This area is for league managers.</p>
          <Link to="/dashboard">Back to the game</Link>
        </div>
      ) : (
        <div className="mx-auto flex max-w-6xl gap-6 px-4 py-4">
          {/* Laptops: a menu down the side. */}
          <nav className="hidden w-48 shrink-0 lg:block" aria-label="Managers">
            <ul className="sticky top-20 space-y-1">
              {LINKS.map(([to, label]) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={to === '/managers'}
                    className={({ isActive }) =>
                      `block rounded-lg px-3 py-2 font-display font-bold uppercase no-underline hover:bg-surface hover:no-underline ${isActive ? 'bg-surface text-brand shadow-card' : 'text-ink-soft'}`
                    }
                  >
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <main className="min-w-0 flex-1">
            <Notices items={notices} />
            <Outlet />
          </main>
        </div>
      )}
    </div>
  );
}

/** Old /manage links (bookmarks) go to the same page under /managers. */
export function ManageRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={pathname.replace(/^\/manage/, '/managers') + search} replace />;
}
