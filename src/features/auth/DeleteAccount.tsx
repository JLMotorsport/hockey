import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Notices, type Notice } from '@/components/ui';
import { sameTeamName } from '@/lib/account';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useLeagueTable } from '@/lib/queries';
import { errorLines, requireSupabase } from '@/lib/supabase';

/**
 * Delete account (boards "Delete account: confirm"): what goes, for good,
 * then type your team name to switch the button on. delete_my_account()
 * checks the name again and removes the login, team, squads and chips.
 */
export function DeleteAccountScreen() {
  const { session, profile } = useAuth();
  const table = useLeagueTable();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);

  if (done) {
    return (
      <div className="card mt-6 max-w-md">
        <h1 className="mt-0">Account deleted</h1>
        <p>Your account and team have gone. Thanks for playing.</p>
        <Link className="btn" to="/">
          Back to the start
        </Link>
      </div>
    );
  }
  if (!session || !profile) return <Navigate to="/login" replace />;

  const points = table.data?.find((r) => r.user_id === profile.id)?.total ?? 0;
  const ready = sameTeamName(typed, profile.team_name);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    const db = requireSupabase();
    const { error } = await db.rpc('delete_my_account', { p_team_name: typed });
    setBusy(false);
    if (error) {
      setNotices(errorLines(error).map((text) => ({ kind: 'error', text })));
      return;
    }
    // The login has gone; clear what this device remembers of it.
    await db.auth.signOut({ scope: 'local' });
    queryClient.clear();
    setDone(true);
  }

  return (
    <div className="card mt-6 max-w-md">
      <h1 className="mt-0">Delete account</h1>
      <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[#b3261e] dark:text-[#ff8a97]">
        This deletes, for good
      </p>
      <ul className="mb-3 list-disc space-y-1.5 pl-5">
        <li>
          Your team, <b>{profile.team_name}</b>, its {points} points and its places in every league
        </li>
        <li>Every squad you have picked, your transfers and the chips you have played</li>
        <li>Your login: {session.user.email} and your password</li>
      </ul>
      <p className="muted text-sm">
        It can&apos;t be undone, and the club can&apos;t bring it back. You can join again later,
        starting a new team from scratch.
      </p>
      <Notices items={notices} />
      <form onSubmit={(e) => void submit(e)}>
        <label className="field">
          Type your team name to confirm
          <input
            className="input"
            autoComplete="off"
            placeholder={profile.team_name}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        <div className="flex flex-col gap-2">
          <button className="btn btn-danger" disabled={!ready || busy}>
            {busy ? 'Deleting' : 'Delete my account'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => navigate(-1)}>
            Keep my account
          </button>
        </div>
      </form>
    </div>
  );
}
