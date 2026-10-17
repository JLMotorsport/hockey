import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Sheet } from '@/components/Sheet';
import { Loading, Notices, type Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import {
  FILTERS,
  blockedBy,
  canUndo,
  clock,
  dayHeading,
  describe,
  groupActions,
  matchesFilter,
  undoLines,
  type Action,
  type Filter,
  type Json,
  type LogRow,
  type Names,
} from '@/lib/changeLog';
import { useAdminUsers, useFixtures, useGameweeks, usePlayers, useSides } from '@/lib/queries';
import { errorLines, requireSupabase } from '@/lib/supabase';
import { Chip, ChipRow, PageHead, panel } from './adminUi';

/**
 * The super user's change log (boards "Change log"): every change a manager
 * makes, newest first, each with Undo. The database (undo_change) checks
 * again and refuses if something has been changed since.
 */
export function ChangeLogScreen() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const log = useQuery({
    queryKey: ['manager-log'],
    enabled: Boolean(profile?.is_super),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('manager_log')
        .select('*')
        .order('id', { ascending: false })
        .limit(1000);
      if (error) throw new Error(error.message);
      return data as unknown as LogRow[];
    },
  });
  const players = usePlayers();
  const sides = useSides();
  const fixtures = useFixtures();
  const gameweeks = useGameweeks();
  const users = useAdminUsers();
  const [filter, setFilter] = useState<Filter>('all');
  const [undoing, setUndoing] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);

  if (!profile?.is_super) {
    return (
      <>
        <PageHead title="Change log" />
        <p className={`${panel} p-5`}>Only the super user can see the change log.</p>
      </>
    );
  }
  if (log.isLoading) return <Loading />;

  const playerName = new Map((players.data ?? []).map((p) => [p.id, p.name]));
  const sideName = new Map((sides.data ?? []).map((s) => [s.id, s.short_name]));
  const fixtureById = new Map((fixtures.data ?? []).map((f) => [f.id, f as unknown as Json]));
  const allGws = gameweeks.data ?? [];
  const person = new Map((users.data ?? []).map((u) => [u.id, u.display_name]));
  const names: Names = {
    player: (id) => playerName.get(id),
    side: (id) => sideName.get(id),
    fixture: (id) => fixtureById.get(id),
    gameweek: (id) => {
      const gw = allGws.find((g) => g.id === id);
      return gw ? allGws.filter((g) => g.start_date <= gw.start_date).length : undefined;
    },
    person: (id) => person.get(id),
  };
  const who = (id: string | null) => (id ? (person.get(id) ?? 'A former manager') : 'Someone');
  const initials = (name: string) =>
    name
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

  const actions = groupActions(log.data ?? []);
  const shown = actions.filter((a) => matchesFilter(a, filter));
  const days: { day: string; items: Action[] }[] = [];
  for (const a of shown) {
    const day = dayHeading(a.at);
    const last = days.at(-1);
    if (last?.day === day) last.items.push(a);
    else days.push({ day, items: [a] });
  }

  async function undo(action: Action) {
    setBusy(true);
    const { error } = await requireSupabase().rpc('undo_change', { p_id: action.id });
    setBusy(false);
    setUndoing(null);
    if (error) {
      setNotices(errorLines(error).map((text) => ({ kind: 'error', text })));
      return;
    }
    setNotices([{ kind: 'success', text: 'Undone. Everything it changed is back as it was.' }]);
    // Points, prices, matches: anything could have moved.
    await queryClient.invalidateQueries();
  }

  return (
    <>
      <PageHead
        title="Change log"
        sub="Every change a manager makes. Undo puts it back as it was. Only you can see this."
      />
      <ChipRow>
        {FILTERS.map(([key, label]) => (
          <Chip key={key} on={filter === key} onClick={() => setFilter(key)}>
            {label}
          </Chip>
        ))}
      </ChipRow>
      <div className="mt-3">
        <Notices items={notices} />
      </div>

      {days.length === 0 && (
        <p className={`${panel} mt-3 p-5`}>
          {actions.length
            ? 'Nothing of that kind yet.'
            : 'No changes yet. Everything managers change from now on shows here.'}
        </p>
      )}

      {days.map(({ day, items }) => (
        <section key={day} className="mt-4">
          <h2 className="mb-1.5 ml-1 text-xs font-bold uppercase tracking-widest text-ink-soft">
            {day}
          </h2>
          <ul className={`${panel} divide-y divide-line overflow-hidden`}>
            {items.map((a) => {
              const text = describe(a, names);
              const actor = who(a.actor);
              const blocker = blockedBy(a, actions);
              const undoable = canUndo(a);
              return (
                <li
                  key={a.tx}
                  className={`flex items-start gap-2.5 px-3.5 py-3 ${a.undoneAt ? 'opacity-60' : ''}`}
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-line text-[11px] font-extrabold"
                  >
                    {initials(actor)}
                  </span>
                  <span className="min-w-0 flex-1 text-sm leading-snug">
                    <b>{actor}</b> {text.what}
                    {text.detail && (
                      <span className="muted mt-0.5 block text-xs">{text.detail}</span>
                    )}
                    {undoable && blocker && (
                      <span className="mt-1 block text-xs font-semibold text-[#b26a00] dark:text-[#ffb547]">
                        Changed again at {clock(blocker.at)}: undo that first
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="muted text-[11px]">{clock(a.at)}</span>
                    {a.undoneAt ? (
                      <span className="muted w-16 text-center text-[11px] leading-tight">
                        Undone
                        <br />
                        {a.undoneBy === profile.id ? 'by you' : `by ${who(a.undoneBy)}`}
                      </span>
                    ) : !undoable ? (
                      <span className="muted w-16 text-center text-[11px] leading-tight">
                        Can&apos;t be undone
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={Boolean(blocker)}
                        onClick={() => setUndoing(a)}
                        className="min-h-tap w-16 rounded-xl text-sm font-bold ring-1 ring-line disabled:border-dashed disabled:opacity-40"
                      >
                        Undo
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {undoing && (
        <Sheet title="Undo this change?" onClose={() => setUndoing(null)}>
          <p className="mb-3">
            {who(undoing.actor)} {describe(undoing, names).what} at {clock(undoing.at)}. Undo puts
            it back as it was before:
          </p>
          <table className="mb-3 w-full overflow-hidden rounded-xl text-sm ring-1 ring-line">
            <tbody className="divide-y divide-line">
              {undoLines(undoing, names).map((l, i) => (
                <tr key={i}>
                  <td className="muted px-3 py-2.5 first-letter:uppercase">{l.label}</td>
                  <td className="muted px-2 py-2.5 text-right line-through">{l.now}</td>
                  <td className="px-3 py-2.5 text-right font-bold">{l.back}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted mb-4 text-xs">
            Points update straight away. Undo can&apos;t be undone, but you can make the change
            again.
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-quiet flex-1" onClick={() => setUndoing(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn flex-1"
              disabled={busy}
              onClick={() => void undo(undoing)}
            >
              {busy ? 'Undoing' : 'Undo'}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
