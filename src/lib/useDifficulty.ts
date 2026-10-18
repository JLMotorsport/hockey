import { useAuth } from '@/lib/auth/AuthProvider';
import type { FdrPlace } from '@/lib/fdr';
import { useFixturePlaces, useSettings } from '@/lib/queries';

/**
 * Fixture difficulty for this viewer: whether to show it, whether it's still
 * the super user's preview, and each fixture's opponent's place in the table.
 */
export function useDifficulty() {
  const { session, profile } = useAuth();
  const settings = useSettings();
  const places = useFixturePlaces(session?.user.id);
  const live = Boolean(settings.data?.fdr_live);
  const preview = !live && Boolean(profile?.is_super);
  return {
    show: live || preview,
    preview,
    places: places.data ?? new Map<number, FdrPlace>(),
    loading: places.isLoading,
  };
}
