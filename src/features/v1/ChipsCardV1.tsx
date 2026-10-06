// This morning's Pick team and Transfers (6 Oct), kept behind the V1/V2 switch for testing.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Sheet } from '@/components/Sheet';
import { RollingSubsIcon, TeamBusIcon, TripleCaptainIcon, WildcardIcon } from '@/components/icons';
import type { Notice } from '@/components/ui';
import { CHIPS, chipStates, type Chip, type ChipKey, type ChipState } from '@/lib/chips';
import { gameweekLabel } from '@/lib/format';
import { keys, useChips, type Gameweek, type Side } from '@/lib/queries';
import { errorLines, requireSupabase } from '@/lib/supabase';

const CHIP_ICONS: Record<ChipKey, () => JSX.Element> = {
  triple_captain: TripleCaptainIcon,
  rolling_subs: RollingSubsIcon,
  wildcard: WildcardIcon,
  team_bus: TeamBusIcon,
};

/** The four chips for the gameweek being picked: play, swap or cancel. */
export function ChipsCard({
  userId,
  gameweek,
  gameweeks,
  sides,
  onNotice,
  only,
}: {
  userId: string;
  gameweek: Gameweek;
  gameweeks: Gameweek[];
  sides: Side[];
  onNotice: (notices: Notice[]) => void;
  /** Which chips belong on this page (team chips on Pick team, wildcard on Transfers). */
  only?: ChipKey[];
}) {
  const queryClient = useQueryClient();
  const chips = useChips(userId);
  const [open, setOpen] = useState<Chip | null>(null);
  const [sideId, setSideId] = useState('');
  const [busy, setBusy] = useState(false);
  const states = chipStates(chips.data ?? [], gameweeks, gameweek.id);
  const active = CHIPS.find((c) => states[c.key].state === 'active');
  const shown = CHIPS.filter((c) => !only || only.includes(c.key));
  const wildcardLocked = active?.key === 'wildcard';
  const sideShort = (id: number | null) => sides.find((s) => s.id === id)?.short_name ?? '';

  async function run(call: () => PromiseLike<{ error: { message: string } | null }>, done: string) {
    setBusy(true);
    const { error } = await call();
    setBusy(false);
    if (error) {
      onNotice(errorLines(error).map((text) => ({ kind: 'error', text })));
    } else {
      onNotice([{ kind: 'success', text: done }]);
      setOpen(null);
    }
    await queryClient.invalidateQueries({ queryKey: keys.chips(userId) });
    await queryClient.invalidateQueries({ queryKey: ['squad'] });
  }

  function label(state: ChipState) {
    if (state.state === 'active') return 'Played';
    if (state.state === 'used') {
      const gw = gameweeks.find((g) => g.id === state.gameweekId);
      return gw ? `Used ${gameweekLabel(gw, gameweeks).split(' ')[0]}` : 'Used';
    }
    return 'Available';
  }

  return (
    <section className="mb-3" aria-label="Chips">
      <div
        className={`grid gap-1.5 ${shown.length === 1 ? 'mx-auto max-w-[11rem] grid-cols-1' : shown.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}
      >
        {shown.map((c) => {
          const state = states[c.key];
          const Icon = CHIP_ICONS[c.key];
          return (
            <button
              key={c.key}
              type="button"
              disabled={state.state === 'used'}
              aria-label={`${c.name}: ${label(state)}`}
              onClick={() => {
                setSideId(state.state === 'active' && state.sideId ? String(state.sideId) : '');
                setOpen(c);
              }}
              className={`flex flex-col items-center gap-0.5 rounded-xl px-1 pb-1.5 pt-1.5 text-center shadow-card ${state.state === 'used' ? 'bg-surface opacity-55' : 'bg-surface'}`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full [&>svg]:h-4 [&>svg]:w-4 ${state.state === 'active' ? 'bg-brand text-white' : 'bg-[#16181d] text-white dark:bg-white dark:text-[#16181d]'}`}
              >
                <Icon />
              </span>
              <span className="whitespace-nowrap font-display text-[0.72rem] font-extrabold uppercase leading-tight">
                {c.name}
              </span>
              <span
                className={`w-full rounded-md py-0.5 font-display text-[0.68rem] font-bold uppercase ${
                  state.state === 'active'
                    ? 'bg-brand text-white'
                    : state.state === 'used'
                      ? 'bg-line text-ink-soft'
                      : 'bg-[#16181d] text-white dark:bg-white dark:text-[#16181d]'
                }`}
              >
                {state.state === 'active'
                  ? c.key === 'team_bus'
                    ? `Active: ${sideShort(state.sideId)}`
                    : 'Active'
                  : state.state === 'used'
                    ? label(state)
                    : 'Play'}
              </span>
            </button>
          );
        })}
      </div>
      {open && (
        <Sheet title={open.name} onClose={() => setOpen(null)}>
          <p className="mb-2">{open.description}</p>
          <p className="muted mb-4 text-sm">
            {label(states[open.key])}. One chip per gameweek, each once a season (wildcard: one each
            side of New Year).
          </p>
          {open.key === 'team_bus' && (
            <label className="field mb-4">
              Side
              <select className="input" value={sideId} onChange={(e) => setSideId(e.target.value)}>
                <option value="">Choose a side</option>
                {sides.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {wildcardLocked && open.key !== 'wildcard' ? (
            <p className="muted text-sm">
              You&apos;ve played your wildcard this gameweek, so no other chip this time.
            </p>
          ) : (
            <div className="grid gap-2">
              {(states[open.key].state !== 'active' || open.key === 'team_bus') &&
                !(open.key === 'wildcard' && wildcardLocked) && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || (open.key === 'team_bus' && !sideId)}
                    onClick={() =>
                      void run(
                        () =>
                          requireSupabase().rpc('play_chip', {
                            p_chip: open.key,
                            p_side_id: open.key === 'team_bus' ? Number(sideId) : undefined,
                          }),
                        `${open.name} played for ${gameweekLabel(gameweek, gameweeks)}.`,
                      )
                    }
                  >
                    {states[open.key].state === 'active'
                      ? 'Change side'
                      : active
                        ? `Play instead of ${active.name}`
                        : open.key === 'wildcard'
                          ? "Play wildcard (can't be undone)"
                          : `Play ${open.name}`}
                  </button>
                )}
              {states[open.key].state === 'active' && open.key !== 'wildcard' && (
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={busy}
                  onClick={() =>
                    void run(() => requireSupabase().rpc('cancel_chip'), `${open.name} cancelled.`)
                  }
                >
                  Cancel {open.name}
                </button>
              )}
              {open.key === 'wildcard' && wildcardLocked && (
                <p className="muted text-sm">
                  Wildcard played: make as many transfers as you like before the deadline.
                </p>
              )}
            </div>
          )}
        </Sheet>
      )}
    </section>
  );
}
