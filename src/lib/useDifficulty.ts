import { useAuth } from '@/lib/auth/AuthProvider';
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
    places: places.data ?? new Map<number, { position: number; teams: number }>(),
    loading: places.isLoading,
  };
}
