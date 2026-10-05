import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Loading, Notices, type Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { formatShortDate } from '@/lib/format';
import { keys, useAdminUsers, useLeagueTable, useProfileSides, useSides } from '@/lib/queries';
import { errorLines, requireSupabase } from '@/lib/supabase';
import { PageHead, SideTag, Toggle, panel } from './adminUi';

export function UsersScreen() {
  const { session } = useAuth();
  const users = useAdminUsers();
  const table = useLeagueTable();
  const profileSides = useProfileSides();
  const sides = useSides();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [notices, setNotices] = useState<Notice[]>([]);
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

  const managers = all.filter((u) => u.is_admin).length;
  return (
    <>
      <PageHead
        title="Users"
        sub={`${all.length} signed up · ${managers} ${managers === 1 ? 'manager' : 'managers'}`}
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
        </div>
        {list.map((u) => {
          const side = profileSides.data?.get(u.id);
          const me = u.id === session?.user.id;
          return (
            <div
              key={u.id}
              className="flex min-h-[64px] items-center gap-2.5 border-b border-line px-3.5 py-2 lg:grid lg:min-h-[54px] lg:grid-cols-[1fr_1fr_80px_80px_110px] lg:gap-3 lg:px-[18px] lg:py-1.5"
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
                  disabled={me}
                  label={`${u.display_name} is a manager`}
                  onChange={(v) => void toggle(u.id, v, u.display_name)}
                />
                <span className="-mt-2 text-[10px] font-bold uppercase text-ink-soft lg:hidden">
                  Manager
                </span>
              </span>
            </div>
          );
        })}
      </section>
      <p className="muted mt-3 text-[13px]">
        Managers can open this area and change players, matches and settings. You can&apos;t remove
        your own manager access.
      </p>
    </>
  );
}
