import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useTeamsWithoutSquad } from '@/lib/queries';

/** For someone signed up who hasn't saved a squad yet: what to do, and a way in. */
export function NoTeamPrompt() {
  const { session } = useAuth();
  const without = useTeamsWithoutSquad();
  if (!session || !without.data?.has(session.user.id)) return null;
  return (
    <div className="mb-3 rounded-2xl border-2 border-[#b26a00] bg-[#fff4e0] p-3.5 text-[#4a2c00] dark:border-[#ffb547]/60 dark:bg-[#3a2a10] dark:text-[#ffe2b0]">
      <p className="m-0 font-bold">You haven&apos;t saved a team yet</p>
      <p className="mb-2.5 mt-1 text-sm">
        Pick your 15 on Transfers, press Next, then Confirm. Until then you score nothing.
      </p>
      <Link className="btn" to="/transfers">
        Pick my team
      </Link>
    </div>
  );
}
