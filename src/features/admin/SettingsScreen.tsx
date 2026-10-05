import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Loading, Notices, type Notice } from '@/components/ui';
import { ALL_FORMATIONS } from '@/lib/formation';
import { keys, useSettings, useSides, type Side } from '@/lib/queries';
import { POINTS, POSITIONS } from '@/lib/scoring';
import { SQUAD_QUOTA, formatPrice, parsePrice } from '@/lib/squad';
import { errorLines, requireSupabase } from '@/lib/supabase';
import { PageHead, SideTag, panel } from './adminUi';

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const SCORING: [string, (string | number)[]][] = [
  ['Played', POSITIONS.map(() => POINTS.appearance)],
  ['Goal (FG, PC or PS)', POSITIONS.map((p) => POINTS.goal[p])],
  ['Assist', POSITIONS.map(() => POINTS.assist)],
  ['Clean sheet', POSITIONS.map((p) => POINTS.cleanSheet[p])],
  ['Every 2 conceded', POSITIONS.map((p) => (p === 'GK' || p === 'DEF' ? -1 : 0))],
  ['Home win / away win', POSITIONS.map(() => `+${POINTS.teamWin.home} / +${POINTS.teamWin.away}`)],
  ['Player of the match', POSITIONS.map(() => POINTS.playerOfMatch)],
  ['Green card', POSITIONS.map(() => POINTS.greenCard)],
  ['Yellow card', POSITIONS.map(() => POINTS.yellowCard)],
  ['Red card', POSITIONS.map(() => POINTS.redCard)],
];

export function SettingsScreen() {
  const settings = useSettings();
  const queryClient = useQueryClient();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [form, setForm] = useState<{
    budget: string;
    max: string;
    transfers: string;
    formations: string[];
  } | null>(null);
  if (settings.isLoading || !settings.data) return <Loading />;
  const s = settings.data;
  const f = form ?? {
    budget: formatPrice(s.budget),
    max: String(s.max_per_side),
    transfers: String(s.transfers_per_gameweek),
    formations: s.formations,
  };

  async function save() {
    const budget = parsePrice(f.budget, 10000);
    if (budget === null) {
      setNotices([{ kind: 'error', text: 'Budget should be a number like 100.0.' }]);
      return;
    }
    if (!f.formations.length) {
      setNotices([{ kind: 'error', text: 'Allow at least one formation.' }]);
      return;
    }
    const { error } = await requireSupabase()
      .from('league_settings')
      .update({
        budget,
        max_per_side: Math.max(1, Number(f.max) || 1),
        transfers_per_gameweek: Math.max(0, Number(f.transfers) || 0),
        formations: ALL_FORMATIONS.filter((x) => f.formations.includes(x)),
      })
      .eq('id', 1);
    if (error) setNotices(errorLines(error).map((text) => ({ kind: 'error', text })));
    else {
      setNotices([{ kind: 'success', text: 'Settings saved.' }]);
      setForm(null);
      await queryClient.invalidateQueries({ queryKey: keys.settings });
    }
  }

  const quota = POSITIONS.map((p) => `${SQUAD_QUOTA[p]} ${p}`).join(', ');
  const rules: [string, string, keyof typeof f | null, string][] = [
    ['Budget (m)', 'Per squad', 'budget', f.budget],
    ['Squad size', quota, null, String(s.squad_size)],
    ['Max from one side', 'Stops a squad being all one side', 'max', f.max],
    ['Free transfers a week', 'Extra ones cost points', 'transfers', f.transfers],
  ];

  return (
    <>
      <PageHead title="Settings">
        <button
          type="button"
          className="hidden min-h-[40px] rounded-full bg-brand px-[18px] font-display text-[15px] font-extrabold uppercase text-white disabled:opacity-50 lg:block"
          disabled={!form}
          onClick={() => void save()}
        >
          Save changes
        </button>
      </PageHead>
      <Notices items={notices} />

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2 lg:items-start">
        <section className={`${panel} p-4 lg:p-5`}>
          <h2 className="mb-1.5 font-display text-xl font-extrabold uppercase lg:text-[22px]">
            Squad rules
          </h2>
          {rules.map(([label, help, key, value]) => (
            <label
              key={label}
              className="flex min-h-[56px] items-center gap-3 border-t border-line"
            >
              <span className="flex-1">
                <span className="block text-[15px] font-semibold">{label}</span>
                <span className="muted block text-xs">{help}</span>
              </span>
              <input
                className="min-h-tap w-[96px] rounded-[10px] border border-line bg-surface px-3 text-right text-base font-bold disabled:border-[#eef0f3] disabled:bg-paper disabled:text-[#8a909b] lg:min-h-[40px]"
                inputMode="decimal"
                disabled={!key}
                value={value}
                onChange={(e) => key && setForm({ ...f, [key]: e.target.value })}
              />
            </label>
          ))}
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <span className="text-[15px] font-semibold">Formations allowed</span>
            <span className="muted text-xs">Defenders, midfielders, forwards, with 1 keeper</span>
            <div className="flex flex-wrap gap-2">
              {ALL_FORMATIONS.map((x) => {
                const on = f.formations.includes(x);
                return (
                  <button
                    key={x}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setForm({
                        ...f,
                        formations: on ? f.formations.filter((y) => y !== x) : [...f.formations, x],
                      })
                    }
                    className={`min-h-tap rounded-full px-3.5 font-display text-[15px] font-extrabold tabular-nums lg:min-h-[36px] ${on ? 'bg-[#16181d] text-white dark:bg-ink dark:text-paper' : 'border border-dashed border-[#c4c9d2] bg-surface text-[#8a909b]'}`}
                  >
                    {x}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            className="mt-4 min-h-[48px] w-full rounded-full bg-brand font-display text-base font-extrabold uppercase text-white disabled:opacity-50 lg:hidden"
            disabled={!form}
            onClick={() => void save()}
          >
            Save changes
          </button>
        </section>

        <details
          className={`${panel} p-4 lg:p-5`}
          open={typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches}
        >
          <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between lg:pointer-events-none">
            <span className="font-display text-xl font-extrabold uppercase lg:text-[22px]">
              Scoring
            </span>
            <span className="rounded-full bg-line px-2.5 py-0.5 text-xs font-bold text-[#3a404b] dark:text-[#c8ced8]">
              Read only
            </span>
          </summary>
          <ScoringTable />
        </details>
      </div>

      <SidesPanel />
    </>
  );
}

function ScoringTable() {
  return (
    <div className="mt-2">
      <div className="grid grid-cols-[1fr_repeat(4,52px)] gap-2 pb-1.5 text-xs font-bold uppercase tracking-wider text-ink-soft">
        <span />
        {POSITIONS.map((p) => (
          <span key={p} className="text-right">
            {p}
          </span>
        ))}
      </div>
      {SCORING.map(([label, values]) => {
        const same = values.every((v) => v === values[0]);
        return (
          <div
            key={label}
            className="grid min-h-[36px] grid-cols-[1fr_repeat(4,52px)] items-center gap-2 border-t border-line text-sm"
          >
            <span>{label}</span>
            {same && typeof values[0] === 'string' ? (
              <span className="col-span-4 text-right font-bold text-[#155c39] dark:text-[#8ee0b0]">
                {values[0]}
              </span>
            ) : (
              values.map((v, i) => (
                <span
                  key={i}
                  className={`text-right font-bold ${typeof v === 'number' ? (v > 0 ? 'text-[#155c39] dark:text-[#8ee0b0]' : v < 0 ? 'text-[#9b1c1c] dark:text-[#ff9a9a]' : 'text-[#8a909b]') : ''}`}
                >
                  {typeof v === 'number' ? signed(v) : v}
                </span>
              ))
            )}
          </div>
        );
      })}
      <p className="muted mt-2 text-xs">
        Captain scores double. Changing points needs a database change, so ask before the season
        rather than part way through.
      </p>
    </div>
  );
}

interface SideDraft {
  name: string;
  short_name: string;
  eh_slug: string;
  pitchero: string;
}

const draftOf = (s?: Side): SideDraft => ({
  name: s?.name ?? '',
  short_name: s?.short_name ?? '',
  eh_slug: s?.eh_slug ?? '',
  pitchero: s?.pitchero_team_id?.toString() ?? '',
});

/** Where the sync reads each side from. */
function SidesPanel() {
  const sides = useSides();
  const queryClient = useQueryClient();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  async function save(id: number | null, v: SideDraft) {
    const row = {
      name: v.name.trim(),
      short_name: v.short_name.trim(),
      eh_slug: v.eh_slug.trim() || null,
      pitchero_team_id: Number(v.pitchero) || null,
    };
    if (!row.name || !row.short_name) {
      setNotices([{ kind: 'error', text: 'Name and short name are required.' }]);
      return;
    }
    const db = requireSupabase();
    const { error } = id
      ? await db.from('sides').update(row).eq('id', id)
      : await db.from('sides').insert({ ...row, sort_order: sides.data?.length ?? 0 });
    if (error) setNotices(errorLines(error).map((text) => ({ kind: 'error', text })));
    else {
      setNotices([{ kind: 'success', text: `Saved ${row.name}.` }]);
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: keys.sides });
    }
  }

  return (
    <section className={`${panel} mt-3.5 overflow-hidden`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-1.5 pt-4 lg:px-[18px]">
        <h2 className="m-0 font-display text-xl font-extrabold uppercase lg:text-[22px]">Sides</h2>
        <span className="muted text-xs lg:text-[13px]">Where the sync reads each side from</span>
      </div>
      <div className="px-4 lg:px-[18px]">
        <Notices items={notices} />
      </div>
      {(sides.data ?? []).map((s) =>
        editing === s.id ? (
          <SideForm
            key={s.id}
            initial={draftOf(s)}
            onSave={(v) => void save(s.id, v)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <button
            key={s.id}
            type="button"
            onClick={() => setEditing(s.id)}
            className="flex min-h-[56px] w-full items-center gap-3 border-t border-line px-4 py-1.5 text-left hover:bg-paper lg:px-[18px]"
          >
            <SideTag>{s.short_name}</SideTag>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">
                {s.name}
                {s.competition && <span className="muted font-normal"> · {s.competition}</span>}
              </span>
              <span className="muted block truncate text-xs">
                <span className={s.eh_slug ? '' : 'text-[#9b1c1c] dark:text-[#ff9a9a]'}>
                  {s.eh_slug ? `England Hockey: ${s.eh_slug}` : 'Not on England Hockey'}
                </span>
                {' · '}
                <span className={s.pitchero_team_id ? '' : 'text-[#9b1c1c] dark:text-[#ff9a9a]'}>
                  {s.pitchero_team_id ? `Pitchero team ${s.pitchero_team_id}` : 'No Pitchero'}
                </span>
              </span>
            </span>
            <span className="text-xl text-[#8a909b]" aria-hidden="true">
              ›
            </span>
          </button>
        ),
      )}
      {editing === 'new' ? (
        <SideForm
          initial={draftOf()}
          onSave={(v) => void save(null, v)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="min-h-tap w-full border-t border-line px-4 text-left text-sm font-bold text-brand lg:px-[18px]"
        >
          + Add a side
        </button>
      )}
    </section>
  );
}

function SideForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: SideDraft;
  onSave: (v: SideDraft) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const input =
    'mt-1 block min-h-tap w-full rounded-[10px] border border-line bg-surface px-2.5 text-base lg:min-h-[40px]';
  const fields: [keyof SideDraft, string, string][] = [
    ['name', 'Name', "e.g. Men's 1s"],
    ['short_name', 'Short', 'M1'],
    ['eh_slug', 'England Hockey page', 'felixstowe-1-mens'],
    ['pitchero', 'Pitchero team id', 'optional'],
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5 border-t border-line bg-paper px-4 py-3 lg:grid-cols-[1fr_90px_1.3fr_140px_auto] lg:items-end lg:px-[18px]">
      {fields.map(([key, label, placeholder]) => (
        <label
          key={key}
          className={`text-xs font-bold uppercase text-ink-soft ${key === 'name' || key === 'eh_slug' ? 'col-span-2 lg:col-span-1' : ''}`}
        >
          {label}
          <input
            className={input}
            placeholder={placeholder}
            inputMode={key === 'pitchero' ? 'numeric' : undefined}
            value={v[key]}
            onChange={(e) => setV({ ...v, [key]: e.target.value })}
          />
        </label>
      ))}
      <span className="col-span-2 flex gap-2 lg:col-span-1">
        <button type="button" className="btn btn-sm" onClick={() => onSave(v)}>
          Save
        </button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={onCancel}>
          Cancel
        </button>
      </span>
      <p className="muted col-span-2 m-0 text-xs lg:col-span-5">
        The England Hockey page is the last part of the side&apos;s address, e.g.
        englandhockey.co.uk/teams/<strong>felixstowe-1-mens</strong>.
      </p>
    </div>
  );
}
