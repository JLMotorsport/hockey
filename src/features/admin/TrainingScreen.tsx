import { useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent } from 'react';
import { Sheet } from '@/components/Sheet';
import { Loading } from '@/components/ui';
import { formatDeadline } from '@/lib/format';
import { ukToday } from '@/lib/gameweek';
import { namesClose, sameName } from '@/lib/pitcheroMatch';
import {
  useGameweeks,
  usePlayers,
  useSettings,
  useSides,
  useTrainingAdmin,
  type Player,
} from '@/lib/queries';
import { errorLines, requireSupabase } from '@/lib/supabase';
import {
  aliasKey,
  likelySame,
  countedCheckIns,
  gameweekForDay,
  readCheckIns,
  TRAINING_CAP,
  type CheckIn,
} from '@/lib/training';
import { PageHead, panel } from './adminUi';

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const dayName = (day: string) => fmt.format(new Date(`${day}T12:00:00Z`));
const ukDate = (iso: string) => ukToday(new Date(iso));

interface Upload {
  checkIns: CheckIn[];
  ignored: number;
}

/**
 * Managers, Training (0044): upload the week's track and trace export, check
 * who gets the point and link any names it can't match, then save.
 */
export function TrainingScreen() {
  const players = usePlayers();
  const sides = useSides();
  const gameweeks = useGameweeks();
  const settings = useSettings();
  const training = useTrainingAdmin();
  const [upload, setUpload] = useState<Upload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (players.isLoading || gameweeks.isLoading || training.isLoading) return <Loading />;

  const all = [...(gameweeks.data ?? [])].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const number = (id: number) => all.findIndex((g) => g.id === id) + 1;
  const from = settings.data?.training_from ?? null;
  const fromGw = from ? all.find((g) => g.start_date >= from) : undefined;
  const days = training.data?.days ?? [];
  const today = ukToday();
  // Gameweeks with check-ins, plus the next one to upload for.
  const next = all.find((g) => ukDate(g.deadline) >= today);
  const shown = all.filter(
    (g) =>
      g.id === next?.id || days.some((d) => gameweekForDay(d.trained_on, all, ukDate)?.id === g.id),
  );

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setDone(null);
    try {
      const everything = readCheckIns(await file.text());
      const counted = countedCheckIns(everything);
      setUpload({ checkIns: counted, ignored: everything.length - counted.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file couldn’t be read.');
    }
  }

  return (
    <>
      <PageHead
        title="Training"
        sub={`+1 a day for checking in to General Club Training between deadlines, up to ${TRAINING_CAP} a gameweek.${fromGw ? ` Counts from GW${number(fromGw.id)} (${dayName(fromGw.start_date)}).` : ''}`}
      />
      <section className={`${panel} mb-4 flex flex-col gap-2.5 p-4`}>
        <p className="m-0 text-sm leading-relaxed text-ink-soft">
          In Pitchero, export Track and trace for the week, then upload it here. You&apos;ll check
          it before anything is saved. Uploading a day again replaces it, so a late check-in can be
          added.
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
          Upload track and trace
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
      </section>

      <section className={`${panel} overflow-hidden`}>
        {[...shown].reverse().map((g, i) => {
          const prev = all[all.indexOf(g) - 1];
          const inWeek = days.filter(
            (d) =>
              d.trained_on <= ukDate(g.deadline) && (!prev || d.trained_on > ukDate(prev.deadline)),
          );
          const people = new Set(inWeek.map((d) => d.player_id)).size;
          const sessions = [...new Set(inWeek.map((d) => d.trained_on))].sort();
          const counts = Boolean(from && g.start_date >= from);
          return (
            <div
              key={g.id}
              className={`flex min-h-[58px] items-center gap-3 px-4 py-2 ${i ? 'border-t border-line' : ''}`}
            >
              <span className="w-12 font-display text-base font-extrabold uppercase">
                GW{number(g.id)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span
                  className={`text-[0.95rem] font-bold ${people ? '' : 'text-[#8a5200] dark:text-[#ffb020]'}`}
                >
                  {people
                    ? `${people} trained${counts ? '' : ' (before training points)'}`
                    : 'Not uploaded yet'}
                </span>
                <span className="text-xs text-ink-soft">
                  {sessions.length
                    ? sessions.map(dayName).join(', ')
                    : `Deadline ${formatDeadline(g.deadline)}`}
                </span>
              </span>
            </div>
          );
        })}
      </section>

      {upload && (
        <TrainingCheck
          upload={upload}
          players={players.data ?? []}
          sideShort={new Map((sides.data ?? []).map((s) => [s.id, s.short_name]))}
          aliases={training.data?.aliases ?? new Map<string, number>()}
          label={(day) => {
            const g = gameweekForDay(day, all, ukDate);
            return g ? `GW${number(g.id)}` : 'no gameweek yet';
          }}
          onClose={() => setUpload(null)}
          onSaved={(text) => {
            setUpload(null);
            setDone(text);
          }}
        />
      )}
    </>
  );
}

function TrainingCheck({
  upload,
  players,
  sideShort,
  aliases,
  label,
  onClose,
  onSaved,
}: {
  upload: Upload;
  players: Player[];
  sideShort: Map<number, string>;
  aliases: Map<string, number>;
  label: (day: string) => string;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  // Names linked by hand this time: a player id, or null for "not in the game".
  const [links, setLinks] = useState(new Map<string, number | null>());
  const [choosing, setChoosing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(players.map((p) => [p.id, p]));
  const names = [...new Set(upload.checkIns.map((c) => c.name))].sort();

  /** A Pitchero name's player: linked before, the same name, or one close one. */
  const auto = (name: string): Player | undefined => {
    const linked = aliases.get(aliasKey(name));
    if (linked) return byId.get(linked);
    const exact = players.find((p) => sameName(p.name, name));
    if (exact) return exact;
    const close = players.filter((p) => namesClose(p.name, name));
    return close.length === 1 ? close[0] : undefined;
  };
  // A suggestion for a name it couldn't match: the same surname, and a first
  // name that looks like the same person's (Becky / Rebecca, Tabby / Tabitha).
  const guess = (name: string) => players.filter((p) => p.active && likelySame(p.name, name));
  const playerFor = (name: string) =>
    links.has(name)
      ? links.get(name) === null
        ? undefined
        : byId.get(links.get(name)!)
      : auto(name);

  const unmatched = names.filter((n) => !auto(n));
  const matched = names.filter((n) => playerFor(n));
  const notInGame = unmatched.filter((n) => links.get(n) === null);
  const toLink = unmatched.filter((n) => !links.has(n));
  const sessionDays = [...new Set(upload.checkIns.map((c) => c.date))].sort();
  const weeks = [...new Set(sessionDays.map(label))];

  async function save() {
    setSaving(true);
    setError(null);
    const rows = upload.checkIns
      .map((c) => ({ player: playerFor(c.name), trained_on: c.date }))
      .filter((r) => r.player)
      .map((r) => ({ player_id: r.player!.id, trained_on: r.trained_on }));
    const newAliases = [...links]
      .filter(([, id]) => id !== null)
      .map(([name, id]) => ({ alias: aliasKey(name), player_id: id }));
    const { error: err } = await requireSupabase().rpc('apply_training', {
      p_days: sessionDays,
      p_rows: rows,
      p_aliases: newAliases,
    });
    setSaving(false);
    if (err) {
      setError(errorLines(err).join(' '));
      return;
    }
    await queryClient.invalidateQueries();
    onSaved(`${matched.length} trained saved for ${weeks.join(' and ')}.`);
  }

  const pill = (p: Player) => (
    <span className="font-display text-xs font-extrabold text-brand">
      {sideShort.get(p.side_id)}
    </span>
  );

  return (
    <Sheet title="Check training" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="m-0 flex items-start gap-2 rounded-xl bg-[#e6f4ec] px-3 py-2.5 text-sm text-[#155c39] dark:bg-[#13261b] dark:text-[#bdeacf]">
          <span aria-hidden="true">✓</span>
          <span>
            <b>General Club Training, {sessionDays.map(dayName).join(', ') || 'no sessions'}</b>{' '}
            counts for <b>{weeks.join(' and ') || 'nothing'}</b>.
            {upload.ignored > 0 && ` ${upload.ignored} check-ins to other sessions are left out.`}
          </span>
        </p>
        <div className="grid grid-cols-4 gap-1.5 text-center">
          {(
            [
              [upload.checkIns.length, 'Checked in', ''],
              [matched.length, 'Get the point', 'text-[#1f7a4d] dark:text-[#3ecf8e]'],
              [toLink.length, 'To link', 'text-[#8a5200] dark:text-[#ffb020]'],
              [notInGame.length, 'Not in the game', 'text-ink-soft'],
            ] as const
          ).map(([v, l, tone]) => (
            <div key={l} className="flex flex-col items-center rounded-xl bg-paper px-1 py-2">
              <span className={`display-num text-2xl leading-none ${tone}`}>{v}</span>
              <span className="text-[0.7rem] leading-tight text-ink-soft">{l}</span>
            </div>
          ))}
        </div>

        {toLink.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="m-0 flex items-baseline gap-2">
              <span className="font-display text-sm font-extrabold uppercase text-[#8a5200] dark:text-[#ffb020]">
                Link these names
              </span>
              <span className="text-xs text-ink-soft">once, remembered after</span>
            </p>
            <ul className="m-0 overflow-hidden rounded-xl bg-paper">
              {toLink.map((name) => {
                const options = guess(name);
                const g = options.length === 1 ? options[0] : undefined;
                return (
                  <li
                    key={name}
                    className="flex flex-col gap-2 border-t border-line p-3 first:border-0"
                  >
                    <span className="text-[0.95rem]">
                      <b>{name}</b> on Pitchero.
                      {g && choosing !== name && (
                        <>
                          {' '}
                          Is this <b>{g.name}</b> {pill(g)}?
                        </>
                      )}
                    </span>
                    {g && choosing !== name ? (
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          className="min-h-tap rounded-[10px] bg-[#1f7a4d] text-sm font-extrabold text-white"
                          onClick={() => setLinks(new Map(links).set(name, g.id))}
                        >
                          Yes, link
                        </button>
                        <button
                          type="button"
                          className="min-h-tap rounded-[10px] text-sm font-bold ring-1 ring-line"
                          onClick={() => setChoosing(name)}
                        >
                          Pick someone else
                        </button>
                      </div>
                    ) : (
                      <select
                        className="input !mt-0"
                        aria-label={`Who is ${name}?`}
                        value=""
                        onChange={(e) => {
                          const v = e.target.value;
                          setLinks(new Map(links).set(name, v === 'none' ? null : Number(v)));
                          setChoosing(null);
                        }}
                      >
                        <option value="" disabled>
                          Choose who this is
                        </option>
                        <option value="none">Not in the fantasy game</option>
                        {players
                          .filter((p) => p.active)
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({sideShort.get(p.side_id)})
                            </option>
                          ))}
                      </select>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {matched.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="m-0 font-display text-sm font-extrabold uppercase text-[#1f7a4d] dark:text-[#3ecf8e]">
              Get the point ({matched.length})
            </p>
            <p className="m-0 rounded-xl bg-paper px-3 py-2.5 text-sm leading-relaxed text-ink-soft">
              {matched
                .map((n) => {
                  const p = playerFor(n)!;
                  return links.has(n) ? `${n} (as ${p.name})` : p.name;
                })
                .join(', ')}
            </p>
          </div>
        )}
        {notInGame.length > 0 && (
          <p className="m-0 text-xs text-ink-soft">
            <b>Not in the fantasy game, skipped:</b> {notInGame.join(', ')}
          </p>
        )}
        {error && (
          <p className="m-0 text-sm font-semibold text-[#b3261e] dark:text-[#ff8a97]">{error}</p>
        )}
        <p className="m-0 text-xs leading-relaxed text-ink-soft">
          Anyone left to link is skipped if you save now. Points show once that gameweek&apos;s
          scores are in.
        </p>
        <button
          type="button"
          disabled={saving || sessionDays.length === 0}
          onClick={() => void save()}
          className="min-h-[50px] rounded-full bg-[#d91414] text-base font-extrabold text-white disabled:opacity-60"
        >
          {saving ? 'Saving' : `Save: ${matched.length} trained for ${weeks.join(' and ')}`}
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
