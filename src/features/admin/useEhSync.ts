import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Notice } from '@/components/ui';
import { requireSupabase } from '@/lib/supabase';

interface SyncResult {
  side: string;
  ok: boolean;
  message: string;
}

/** "Sync now": runs eh-sync for every side, then reloads everything. */
export function useEhSync() {
  const queryClient = useQueryClient();
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

  return { syncing, notices, sync };
}
