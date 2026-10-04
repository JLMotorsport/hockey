import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Notices, type Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { requireSupabase } from '@/lib/supabase';

const LINKS: [string, string][] = [
  ['/manage', 'Overview'],
  ['/manage/fixtures', 'Fixtures & stats'],
  ['/manage/players', 'Players'],
  ['/manage/deadlines', 'Deadlines'],
  ['/manage/sides', 'Sides'],
  ['/manage/users', 'Users'],
  ['/manage/settings', 'Settings'],
];

interface SyncResult {
  side: string;
  ok: boolean;
  message: string;
}

export function AdminLayout() {
  const { profile, loading } = useAuth();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);

  if (loading) return null;
  if (!profile?.is_admin) {
    return (
      <div className="card mt-6 max-w-md">
        <h1 className="mt-0">Managers only</h1>
        <p>That page is for league managers.</p>
      </div>
    );
  }

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
    <>
      <h1>Manager dashboard</h1>
      <nav className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-3">
        {LINKS.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) => (isActive ? 'font-semibold' : '')}
          >
            {label}
          </NavLink>
        ))}
        <button
          type="button"
          className="btn btn-sm ml-auto"
          disabled={syncing}
          onClick={() => void sync()}
        >
          {syncing ? 'Syncing' : 'Sync from England Hockey'}
        </button>
      </nav>
      <Notices items={notices} />
      <Outlet />
    </>
  );
}
