import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Sheet } from '@/components/Sheet';
import { Loading, Notices, type Notice } from '@/components/ui';
import { sameTeamName } from '@/lib/account';
import { useAuth } from '@/lib/auth/AuthProvider';
import { formatShortDate } from '@/lib/format';
import { keys, useAdminUsers, useLeagueTable, useProfileSides, useSides } from '@/lib/queries';
import { errorLines, requireSupabase } from '@/lib/supabase';
import { PageHead, SideTag, Toggle, panel } from './adminUi';

export function UsersScreen() {
  const { session, profile } = useAuth();
  // Only the super user makes or removes managers (the database enforces it).
  const canAppoint = Boolean(profile?.is_super);
  const users = useAdminUsers();
  const table = useLeagueTable();
  const profileSides = useProfileSides();
  const sides = useSides();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [notices, setNotices] = useState<Notice[]>([]);
  // Removing someone who asked the club: they're picked, then confirmed by team name.
  const [removing, setRemoving] = useState<{ id: string; name: string; team: string } | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  if (users.isLoading) return <Loading />;

  const points = new Map((table.data ?? []).map((r) => [r.user_id, r.total]));
  const sideName = new Map((sides.data ?? []).map((s) => [s.id, s.short_name]));
  const all = users.data ?? [];
  const q = search.trim().toLowerCase();
  const list = all.filter(
    (u) =>
      !q ||
      u.display_name.toLowerCase().includes(q) ||
      u.team_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q),
  );

  async function toggle(id: string, value: boolean, name: string) {
    const { error } = await requireSupabase().rpc('set_admin', { p_user: id, p_value: value });
    if (error) setNotices(errorLines(error).map((text) => ({ kind: 'error', text })));
    else {
      setNotices([
        { kind: 'success', text: `${name} is ${value ? 'now' : 'no longer'} a manager.` },
      ]);
      await queryClient.invalidateQueries({ queryKey: keys.adminUsers });
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    const { error } = await requireSupabase().rpc('remove_user', {
      p_user: removing.id,
      p_team_name: typed,
    });
    setBusy(false);
    if (error) {
      setNotices(errorLines(error).map((text) => ({ kind: 'error', text })));
    } else {
      setNotices([
        { kind: 'success', text: `${removing.name} and ${removing.team} have been removed.` },
      ]);
      await queryClient.invalidateQueries();
    }
    setRemoving(null);
    setTyped('');
  }

  const managers = all.filter((u) => u.is_admin).length;
  const superUser = all.find((u) => u.is_super);
  return (
    <>
      <PageHead
        title="Users"
        sub={`${all.length} signed up · ${managers} ${managers === 1 ? 'manager' : 'managers'}${superUser ? ` · super user: ${superUser.display_name}` : ''}`}
      >
        <input
          type="search"
          placeholder="Search name or team"
          aria-label="Search"
          className="min-h-tap w-full rounded-[10px] border border-line bg-surface px-3 text-base lg:min-h-[40px] lg:w-[260px]"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </PageHead>
      <Notices items={notices} />
      <section className={`${panel} overflow-hidden`}>
        <div className="hidden grid-cols-[1fr_1fr_80px_80px_110px] gap-3 border-b border-line px-[18px] py-3 text-xs font-bold uppercase tracking-wider text-ink-soft lg:grid">
          <span>Name</span>
          <span>Team</span>
          <span>Plays for</span>
          <span className="text-right">Pts</span>
          <span className="text-right">Manager</span>
          <span />
        </div>
        {list.map((u) => {
          const side = profileSides.data?.get(u.id);
          const me = u.id === session?.user.id;
          return (
            <div
              key={u.id}
              className="flex min-h-[64px] items-center gap-2.5 border-b border-line px-3.5 py-2 lg:grid lg:min-h-[54px] lg:grid-cols-[1fr_1fr_80px_80px_110px_96px] lg:gap-3 lg:px-[18px] lg:py-1.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold lg:font-semibold">
                  {u.display_name}
                  <span
                    className={`ml-1.5 font-display text-xs font-extrabold lg:hidden ${side ? 'text-brand' : 'text-[#8a909b]'}`}
                  >
                    {side ? sideName.get(side) : 'No side'}
                  </span>
                </span>
                <span className="muted block truncate text-xs">
                  <span className="lg:hidden">
                    {u.team_name} · {points.get(u.id) ?? 0} pts
                  </span>
                  <span className="hidden lg:inline">
                    {u.email} · joined {formatShortDate(u.created_at.slice(0, 10))}
                  </span>
                </span>
              </span>
              <span className="hidden truncate text-[15px] lg:block">{u.team_name}</span>
              <span className="hidden lg:block">
                {side ? (
                  <SideTag>{sideName.get(side)}</SideTag>
                ) : (
                  <span className="muted text-sm">None</span>
                )}
              </span>
              <span className="hidden text-right font-display text-lg font-extrabold lg:block">
                {points.get(u.id) ?? 0}
              </span>
              <span className="flex flex-col items-center lg:items-end">
                <Toggle
                  checked={u.is_admin}
                  disabled={me || !canAppoint || u.is_super}
                  label={`${u.display_name} is a manager`}
                  onChange={(v) => void toggle(u.id, v, u.display_name)}
                />
                <span className="-mt-2 text-[10px] font-bold uppercase text-ink-soft lg:hidden">
                  {u.is_super ? 'Super user' : 'Manager'}
                </span>
              </span>
              <span className="flex w-[72px] justify-end lg:w-auto">
                {me ? (
                  <span className="muted text-xs">You</span>
                ) : u.is_super || (u.is_admin && !canAppoint) ? null : (
                  <button
                    type="button"
                    className="min-h-tap rounded-xl px-3 text-sm font-bold text-[#b3261e] ring-1 ring-[#b3261e]/40 dark:text-[#ff8a97] dark:ring-[#ff8a97]/40"
                    onClick={() => {
                      setTyped('');
                      setRemoving({ id: u.id, name: u.display_name, team: u.team_name });
                    }}
                  >
                    Remove
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </section>
      {removing && (
        <Sheet title={`Remove ${removing.name}?`} onClose={() => setRemoving(null)}>
          <p className="mb-2">
            This deletes {removing.name}&apos;s account and team, <b>{removing.team}</b> (
            {points.get(removing.id) ?? 0} points), with every squad, transfer and chip, and takes
            the team out of every league table. It can&apos;t be undone.
          </p>
          <p className="muted mb-3 text-sm">
            Only do this if {removing.name} has asked. They can join again later with a new team.
          </p>
          <label className="field">
            Type the team name to confirm
            <input
              className="input"
              autoComplete="off"
              placeholder={removing.team}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-quiet flex-1"
              onClick={() => setRemoving(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger flex-1"
              disabled={!sameTeamName(typed, removing.team) || busy}
              onClick={() => void remove()}
            >
              {busy ? 'Removing' : 'Remove'}
            </button>
          </div>
        </Sheet>
      )}
      <p className="muted mt-3 text-[13px]">
        Managers can open this area and change players, matches and settings. Only the super user
        can make or remove managers, and the super user is always one. Remove deletes someone&apos;s
        account and team, for when they ask the club.
      </p>
    </>
  );
}
