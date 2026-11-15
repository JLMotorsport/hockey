import { useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent, type ReactNode } from 'react';
import { Sheet } from '@/components/Sheet';
import { formatDeadline } from '@/lib/format';
import { ukToday } from '@/lib/gameweek';
import { namesClose, sameName } from '@/lib/pitcheroMatch';
import {
  exportDate,
  readAvailability,
  type AvailabilityFlag,
  type AvailabilityRow,
} from '@/lib/pitcheroAvailability';
import type { PlayerFlag } from '@/lib/playerStatus';
import { keys, useGameweeks, usePlayerFlags, type Player, type Side } from '@/lib/queries';
import { errorLines, requireSupabase } from '@/lib/supabase';
import { panel } from './adminUi';

const day = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const dayOf = (isoDay: string) => day.format(new Date(`${isoDay}T12:00:00Z`));
/** Two days on: a Saturday's flags clear on the Monday. */
const plusTwo = (isoDay: string) =>
  new Date(Date.parse(`${isoDay}T12:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);

interface Matched extends AvailabilityRow {
  player?: Player;
}

/**
 * Managers, Players: upload next Saturday's Pitchero availability export, check
 * who it flags, then confirm (0043). Nothing changes until confirmed.
 */
export function AvailabilityUpload({ players, sides }: { players: Player[]; sides: Side[] }) {
  const queryClient = useQueryClient();
  const gameweeks = useGameweeks();
  const flags = usePlayerFlags().data ?? new Map<number, PlayerFlag>();
  const [preview, setPreview] = useState<{ date: string | null; rows: Matched[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const fromPitchero = [...flags.values()].filter((f) => f.source === 'pitchero');
  const lastAt = fromPitchero
    .map((f) => f.set_at)
    .sort()
    .at(-1);
  const sideShort = new Map(sides.map((s) => [s.id, s.short_name]));

  /** The player in the game for a Pitchero name: the same name, else one close one. */
  const find = (name: string) => {
    const exact = players.find((p) => sameName(p.name, name));
    if (exact) return exact;
    const close = players.filter((p) => namesClose(p.name, name));
    return close.length === 1 ? close[0] : undefined;
  };

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setDone(null);
    try {
      const rows = readAvailability(await file.text());
      setPreview({
        date: exportDate(file.name),
        rows: rows.map((r) => ({ ...r, player: find(r.name) })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file couldn’t be read.');
    }
  }

  async function confirm() {
    if (!preview?.date) return;
    const today = dayOf(ukToday());
    const back_by = plusTwo(preview.date);
    const toFlag = preview.rows.filter(
      (r) => r.flag && r.player && flags.get(r.player.id)?.source !== 'manager',
    );
    setSaving(true);
    const { data, error: err } = await requireSupabase().rpc('apply_pitchero_availability', {
      p_flags: toFlag.map((r) => ({
        player_id: r.player!.id,
        status: r.flag!,
        note: r.flag === 'out' ? `Unavailable (Pitchero, ${today})` : `Pitchero, ${today}`,
        back_by,
      })),
    });
    setSaving(false);
    if (err) {
      setError(errorLines(err).join(' '));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['player-flags'] });
    await queryClient.invalidateQueries({ queryKey: keys.players });
    setPreview(null);
    setDone(`${data ?? 0} players flagged from Pitchero.`);
  }

  return (
    <section className={`${panel} mb-4 flex flex-col gap-2.5 p-4`}>
      <h2 className="m-0 flex items-center gap-2 font-sans text-lg font-extrabold normal-case tracking-normal [font-stretch:100%]">
        <span
          aria-hidden="true"
          className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#d91414] text-[0.8rem] font-black text-white"
        >
          !
        </span>
        Pitchero availability
      </h2>
      <p className="m-0 text-sm leading-relaxed text-ink-soft">
        Flags who can&apos;t play this weekend. In Pitchero, open Availability, pick Saturday&apos;s
        date and Export. Then upload the file here. You&apos;ll see who it flags before anything
        changes.
      </p>
      <label className="flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-full bg-[#d91414] text-base font-extrabold text-white lg:max-w-xs">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-[18px] w-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
        </svg>
        Upload Pitchero file
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => void choose(e)}
        />
      </label>
      {error && (
        <p className="m-0 text-sm font-semibold text-[#b3261e] dark:text-[#ff8a97]">{error}</p>
      )}
      {done && (
        <p className="m-0 text-sm font-semibold text-[#1f7a4d] dark:text-[#7fd6a2]">{done}</p>
      )}
      <p className="m-0 text-xs text-ink-soft">
        {lastAt
          ? `Last upload: ${day.format(new Date(lastAt))} · ${fromPitchero.length} flagged now.`
          : 'No Pitchero flags at the moment.'}{' '}
        Best done Friday evening, when most people have answered.
      </p>
      {preview && (
        <AvailabilityCheck
          date={preview.date}
          rows={preview.rows}
          flags={flags}
          sideShort={sideShort}
          gameweeks={gameweeks.data ?? []}
          saving={saving}
          onConfirm={() => void confirm()}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  );
}

function AvailabilityCheck({
  date,
  rows,
  flags,
  sideShort,
  gameweeks,
  saving,
  onConfirm,
  onClose,
}: {
  date: string | null;
  rows: Matched[];
  flags: Map<number, PlayerFlag>;
  sideShort: Map<number, string>;
  gameweeks: { id: number; start_date: string; deadline: string }[];
  saving: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const inGame = rows.filter((r) => r.player);
  const mine = (r: Matched) => flags.get(r.player!.id)?.source === 'manager';
  const of = (flag: AvailabilityFlag) => inGame.filter((r) => r.flag === flag && !mine(r));
  const out = of('out');
  const doubtful = of('doubtful');
  const picked = inGame.filter((r) => r.pickedDespiteNo);
  const kept = inGame.filter((r) => r.flag && mine(r));
  const notInGame = rows.filter((r) => r.flag && !r.player);
  const sorted = [...gameweeks].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const gw = date ? sorted.find((g) => g.start_date === date) : undefined;
  const gwNumber = gw ? sorted.indexOf(gw) + 1 : 0;
  const past = Boolean(date && date < ukToday());
  const total = out.length + doubtful.length;

  const line = (r: Matched, why = r.why) => (
    <li
      key={r.name}
      className="flex min-h-[48px] flex-col justify-center border-t border-line px-3 py-1.5 first:border-0"
    >
      <span className="text-[0.95rem] font-bold">
        {r.player?.name ?? r.name}{' '}
        {r.player && (
          <span className="font-display text-xs font-extrabold text-brand">
            {sideShort.get(r.player.side_id)}
          </span>
        )}
      </span>
      <span className="text-xs text-ink-soft">{why}</span>
    </li>
  );
  const group = (
    title: string,
    help: string,
    tone: string,
    list: Matched[],
    render = line,
  ): ReactNode =>
    list.length > 0 && (
      <div className="flex flex-col gap-1.5">
        <p className="m-0 flex items-baseline gap-2">
          <span className={`font-display text-sm font-extrabold uppercase ${tone}`}>{title}</span>
          <span className="text-xs text-ink-soft">{help}</span>
        </p>
        <ul className="m-0 overflow-hidden rounded-xl bg-paper">{list.map((r) => render(r))}</ul>
      </div>
    );

  return (
    <Sheet title="Check before flagging" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {!date ? (
          <p className="m-0 rounded-xl bg-[#fff4e5] px-3 py-2.5 text-sm text-[#6b3d00] dark:bg-[#2b2113] dark:text-[#f5d9a8]">
            The file name doesn&apos;t say which day it&apos;s for. Upload the file as Pitchero
            exported it (its name ends with the date).
          </p>
        ) : (
          <p
            className={`m-0 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm ${gw && !past ? 'bg-[#e6f4ec] text-[#155c39] dark:bg-[#13261b] dark:text-[#bdeacf]' : 'bg-[#fff4e5] text-[#6b3d00] dark:bg-[#2b2113] dark:text-[#f5d9a8]'}`}
          >
            <span aria-hidden="true">{gw && !past ? '✓' : '!'}</span>
            <span>
              {gw ? (
                <>
                  <b>
                    {dayOf(date)} is GW{gwNumber}
                  </b>
                  , deadline {formatDeadline(gw.deadline)}.
                </>
              ) : (
                <>
                  <b>No gameweek starts {dayOf(date)}.</b> Check you exported the right day.
                </>
              )}
              {past && ' That day has passed, so this would flag people for a weekend gone.'}
            </span>
          </p>
        )}
        <div className="grid grid-cols-4 gap-1.5 text-center">
          {(
            [
              [out.length, 'Flagged Out', 'text-[#b3261e] dark:text-[#ff6b6b]'],
              [doubtful.length, 'Doubtful', 'text-[#8a5200] dark:text-[#ffb020]'],
              [picked.length, 'Picked for another side', ''],
              [notInGame.length, 'Not in the game', 'text-ink-soft'],
            ] as const
          ).map(([v, l, tone]) => (
            <div key={l} className="flex flex-col items-center rounded-xl bg-paper px-1 py-2">
              <span className={`display-num text-2xl leading-none ${tone}`}>{v}</span>
              <span className="text-[0.7rem] leading-tight text-ink-soft">{l}</span>
            </div>
          ))}
        </div>
        {group('Will be flagged Out', `${out.length}`, 'text-[#b3261e] dark:text-[#ff6b6b]', out)}
        {group(
          'Will be flagged Doubtful',
          'no or not sure for one side, yes for another, not picked yet',
          'text-[#8a5200] dark:text-[#ffb020]',
          doubtful,
        )}
        {group('Not flagged: picked for another side', 'they are playing', '', picked)}
        {group(
          'Already flagged by you',
          'kept as it is',
          'text-[#8a5200] dark:text-[#ffb020]',
          kept,
          (r) =>
            line(
              r,
              `${flags.get(r.player!.id)?.status === 'out' ? 'Out' : 'Doubtful'}: ${flags.get(r.player!.id)?.note ?? ''} (yours), not changed`,
            ),
        )}
        {notInGame.length > 0 && (
          <p className="m-0 text-xs text-ink-soft">
            <b>Not in the fantasy game, skipped:</b> {notInGame.map((r) => r.name).join(', ')}
          </p>
        )}
        <p className="m-0 text-xs leading-relaxed text-ink-soft">
          Players see only Out or Doubtful with &ldquo;Pitchero&rdquo; and today&apos;s date, never
          which match or the notes people wrote. The last upload&apos;s flags are replaced. Flags
          you set by hand are never changed. These clear on the Monday after.
        </p>
        <button
          type="button"
          disabled={saving || !date}
          onClick={onConfirm}
          className="min-h-[50px] rounded-full bg-[#d91414] text-base font-extrabold text-white disabled:opacity-60"
        >
          {saving
            ? 'Saving'
            : total
              ? `Flag ${total} player${total === 1 ? '' : 's'}${gwNumber ? ` for GW${gwNumber}` : ''}`
              : 'Nobody to flag: clear the last upload'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="min-h-tap text-sm font-bold text-ink-soft"
        >
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
