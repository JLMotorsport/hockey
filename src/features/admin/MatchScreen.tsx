import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorText, Loading, Notices, PosBadge, type Notice } from '@/components/ui';
import { formatDayTime, gameweekLabel } from '@/lib/format';
import { opponentName } from '@/lib/form';
import { nameKey } from '@/lib/pitcheroMatch';
import {
  keys,
  useFixtureDetail,
  useGameweeks,
  usePitcheroEvidence,
  usePlayers,
  useSides,
  type Player,
} from '@/lib/queries';
import { POSITIONS, points } from '@/lib/scoring';
import { errorLines, requireSupabase } from '@/lib/supabase';
import { SideTag, Toggle, panel } from './adminUi';

interface Line {
  played: boolean;
  goals: number;
  assists: number;
  green_cards: number;
  yellow_cards: number;
  red_cards: number;
}

const EMPTY: Line = {
  played: false,
  goals: 0,
  assists: 0,
  green_cards: 0,
  yellow_cards: 0,
  red_cards: 0,
};

const CARDS = [
  ['green_cards', 'Green', 'bg-[#dff3e6] dark:bg-[#123d27] ring-[#1f7a4d]'],
  ['yellow_cards', 'Yellow', 'bg-[#fff4c2] dark:bg-[#3d3410] ring-[#e0b100]'],
  ['red_cards', 'Red', 'bg-[#fde8e8] dark:bg-[#4a1616] ring-[#9b1c1c]'],
] as const;

/** One match: score, who played, goals, cards, player of the match, lock. */
export function MatchScreen() {
  const id = Number(useParams().id);
  const detail = useFixtureDetail(id);
  const evidence = usePitcheroEvidence();
  const players = usePlayers();
  const sides = useSides();
  const gameweeks = useGameweeks();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [lines, setLines] = useState<Map<number, Line>>(new Map());
  const [potm, setPotm] = useState<number | null>(null);
  const [score, setScore] = useState({ for: '', against: '' });
  const [complete, setComplete] = useState(false);
  const [extra, setExtra] = useState<number[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [tab, setTab] = useState<'sheet' | 'pitchero'>('sheet');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);

  function reset() {
    if (!detail.data) return;
    const { fixture, performances } = detail.data;
    setLines(new Map(performances.map((p) => [p.player_id, { ...p, played: true }])));
    setPotm(performances.find((p) => p.player_of_match)?.player_id ?? null);
    setScore({
      for: fixture.goals_for?.toString() ?? '',
      against: fixture.goals_against?.toString() ?? '',
    });
    setComplete(fixture.stats_complete);
    setExtra([]);
    setDirty(false);
  }
  useEffect(reset, [detail.data]);

  if (detail.isLoading || players.isLoading || sides.isLoading) return <Loading />;
  if (detail.error || !detail.data) return <ErrorText error={detail.error} />;
  const { fixture, performances } = detail.data;
  const sideById = new Map((sides.data ?? []).map((s) => [s.id, s]));
  const shirt = new Map(performances.map((p) => [p.player_id, p.shirt]));
  const gw = gameweeks.data?.find((g) => g.id === fixture.gameweek_id);
  const all = players.data ?? [];

  const line = (pid: number) => lines.get(pid) ?? EMPTY;
  function update(pid: number, patch: Partial<Line>) {
    const next = new Map(lines);
    const merged = { ...line(pid), ...patch };
    // Entering a stat means they played.
    if (!('played' in patch)) merged.played = true;
    next.set(pid, merged);
    setLines(next);
    setDirty(true);
  }

  const order = (a: Player, b: Player) =>
    (shirt.get(a.id) ? Number(shirt.get(a.id)) : 99) -
      (shirt.get(b.id) ? Number(shirt.get(b.id)) : 99) ||
    POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) ||
    a.name.localeCompare(b.name);
  const playedList = all.filter((p) => line(p.id).played).sort(order);
  const benchList = all
    .filter(
      (p) =>
        !line(p.id).played && p.active && (p.side_id === fixture.side_id || extra.includes(p.id)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const others = all
    .filter(
      (p) =>
        p.active && p.side_id !== fixture.side_id && !line(p.id).played && !extra.includes(p.id),
    )
    .sort((a, b) => a.side_id - b.side_id || a.name.localeCompare(b.name));

  const toInt = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.floor(Number(v))));
  const gf = toInt(score.for);
  const ga = toInt(score.against);
  const ptsFor = (p: Player) =>
    points({
      ...line(p.id),
      position: p.position,
      player_of_match: potm === p.id,
      goals_for: gf,
      goals_against: ga,
      is_home: fixture.is_home,
    });

  // Pitchero's sheet, matched against named players who played here.
  const sheet = (evidence.data?.sheets ?? []).filter((r) => r.fixture_id === fixture.id);
  const playedKeys = new Set(
    playedList.filter((p) => !p.name_withheld).map((p) => nameKey(p.name)),
  );
  const unnamedHere = playedList.filter((p) => p.name_withheld).length;

  async function save() {
    setSaving(true);
    const stats = [...lines.entries()]
      .filter(([, l]) => l.played)
      .map(([player_id, l]) => ({
        player_id,
        goals: l.goals,
        assists: l.assists,
        green_cards: l.green_cards,
        yellow_cards: l.yellow_cards,
        red_cards: l.red_cards,
        player_of_match: potm === player_id,
      }));
    const { error } = await requireSupabase().rpc('save_match_stats', {
      p_fixture_id: fixture.id,
      p_goals_for: gf as number,
      p_goals_against: ga as number,
      p_stats: stats,
      p_complete: complete,
    });
    setSaving(false);
    if (error) {
      setNotices(errorLines(error).map((text) => ({ kind: 'error', text })));
      return;
    }
    setNotices([{ kind: 'success', text: 'Match saved.' }]);
    await queryClient.invalidateQueries();
  }

  async function setLock(locked: boolean) {
    const { error } = await requireSupabase().rpc('set_stats_lock', {
      p_fixture_id: fixture.id,
      p_locked: locked,
    });
    if (error) setNotices(errorLines(error).map((text) => ({ kind: 'error', text })));
    else await queryClient.invalidateQueries();
  }

  async function remove() {
    if (!window.confirm('Delete this match and its stats?')) return;
    const { error } = await requireSupabase().from('fixtures').delete().eq('id', fixture.id);
    if (error) setNotices(errorLines(error).map((text) => ({ kind: 'error', text })));
    else {
      await queryClient.invalidateQueries({ queryKey: keys.fixtures });
      navigate('/managers/matches');
    }
  }

  const source = fixture.stats_locked
    ? 'Locked: the sync leaves this match alone.'
    : fixture.lineup_imported_at
      ? `Line-up from England Hockey, ${formatDayTime(fixture.lineup_imported_at)}. Player of the match, assists and players added by hand are kept when it syncs.`
      : fixture.eh_fixture_id
        ? 'No line-up on England Hockey yet. It comes in on the next sync once the team enters it, or fill it in here.'
        : 'Added by hand: fill in who played.';

  const scoreBox =
    'h-14 w-16 rounded-[10px] border border-line bg-surface text-center font-display text-[32px] font-extrabold focus:border-brand focus:outline-none';

  return (
    <div className="pb-24">
      <Link
        to="/managers/matches"
        className="mb-3 inline-flex min-h-tap items-center gap-1 font-display text-base font-extrabold uppercase text-ink-soft no-underline hover:no-underline"
      >
        <span className="text-2xl leading-none">‹</span> Matches
      </Link>

      <section
        className={`${panel} mb-3 flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:gap-6 lg:p-5`}
      >
        <div className="flex flex-1 items-center gap-2.5">
          <SideTag className="text-base">{sideById.get(fixture.side_id)?.short_name}</SideTag>
          <div>
            <h1 className="m-0 font-display text-[22px] font-extrabold uppercase leading-none lg:text-3xl">
              {fixture.is_home ? 'v' : 'at'} {opponentName(fixture.opponent)}
            </h1>
            <p className="muted mt-1 text-xs lg:text-sm">
              {formatDayTime(fixture.kickoff)}
              {gw && ` · ${gameweekLabel(gw, gameweeks.data ?? [])}`}
              {fixture.competition && ` · ${fixture.competition}`}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-center gap-3">
          <label className="flex flex-col items-center gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">
              Felixstowe
            </span>
            <input
              className={scoreBox}
              type="number"
              inputMode="numeric"
              min={0}
              value={score.for}
              onChange={(e) => {
                setScore({ ...score, for: e.target.value });
                setDirty(true);
              }}
            />
          </label>
          <span className="pt-5 text-2xl text-[#8a909b]">-</span>
          <label className="flex flex-col items-center gap-1">
            <span className="max-w-[7rem] truncate text-[11px] font-bold uppercase tracking-wider text-ink-soft">
              {opponentName(fixture.opponent).replace(/\s+\d+$/, '')}
            </span>
            <input
              className={scoreBox}
              type="number"
              inputMode="numeric"
              min={0}
              value={score.against}
              onChange={(e) => {
                setScore({ ...score, against: e.target.value });
                setDirty(true);
              }}
            />
          </label>
        </div>
        <div className="flex flex-col lg:w-[300px]">
          <div className="flex min-h-[52px] items-center gap-3 border-t border-line lg:border-t-0">
            <span className="flex-1">
              <span className="block text-[15px] font-bold">Stats complete</span>
              <span className="muted block text-xs">Saved with the match</span>
            </span>
            <Toggle
              checked={complete}
              label="Stats complete"
              onChange={(v) => {
                setComplete(v);
                setDirty(true);
              }}
            />
          </div>
          {fixture.eh_fixture_id && (
            <div className="flex min-h-[52px] items-center gap-3 border-t border-line">
              <span className="flex-1">
                <span className="block text-[15px] font-bold">Lock this match</span>
                <span className="muted block text-xs">The sync will never change it</span>
              </span>
              <Toggle
                checked={fixture.stats_locked}
                label="Lock this match"
                onChange={(v) => void setLock(v)}
              />
            </div>
          )}
        </div>
      </section>

      <Notices items={notices} />
      <p className="muted mb-3 text-[13px]">
        {source}
        {fixture.score_overridden && ' Score entered by hand, so the sync will not change it.'}
      </p>
      {fixture.withheld_count > 0 && (
        <p className="mb-3 rounded-xl bg-[#fff1dc] dark:bg-[#4a3010] px-3 py-2 text-sm text-[#7a4600] dark:text-[#ffc773]">
          England Hockey lists {fixture.withheld_count} player(s) with no member id, so they
          can&apos;t be imported. Add them below from Didn&apos;t play, with any goals or cards.
        </p>
      )}

      {/* Phone: one list at a time. */}
      <div className="mb-3 flex rounded-full bg-line p-1 lg:hidden" role="tablist">
        {(
          [
            ['sheet', `Team sheet (${playedList.length})`],
            ['pitchero', `Pitchero (${sheet.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-[40px] flex-1 rounded-full font-display text-[15px] font-extrabold uppercase ${tab === key ? 'bg-surface shadow' : 'text-ink-soft'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        <div className={tab === 'sheet' ? '' : 'hidden lg:block'}>
          <section className={`${panel} overflow-hidden`}>
            <div className="hidden grid-cols-[28px_1fr_100px_100px_128px_40px_32px] items-center gap-2 border-b border-line px-4 py-3 text-xs font-bold uppercase tracking-wider text-ink-soft lg:grid">
              <span>#</span>
              <span>Player</span>
              <span className="text-center">Goals</span>
              <span className="text-center">Assists</span>
              <span className="text-center">Cards</span>
              <span className="text-center">POTM</span>
              <span className="text-right">Pts</span>
            </div>
            {playedList.map((p) => {
              const l = line(p.id);
              const isOpen = open === p.id;
              const covering = p.side_id !== fixture.side_id;
              const summary = [
                l.goals && `${l.goals} goal${l.goals > 1 ? 's' : ''}`,
                l.assists && `${l.assists} assist${l.assists > 1 ? 's' : ''}`,
                l.green_cards && 'green',
                l.yellow_cards && 'yellow',
                l.red_cards && 'red',
                potm === p.id && 'POTM',
              ]
                .filter(Boolean)
                .join(', ');
              return (
                <div
                  key={p.id}
                  className={`border-b border-line ${p.name_withheld ? 'bg-[#fff4f4] dark:bg-[#2e1a1c]' : isOpen ? 'bg-[#fafbfc] dark:bg-[#1d2129]' : ''}`}
                >
                  <div className="flex min-h-[56px] items-center gap-2.5 px-3.5 py-1.5 lg:grid lg:grid-cols-[28px_1fr_100px_100px_128px_40px_32px] lg:gap-2 lg:px-4">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-line text-[13px] font-bold">
                      {shirt.get(p.id) ?? ''}
                    </span>
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left lg:pointer-events-none"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : p.id)}
                    >
                      <span
                        className={`block truncate text-[15px] font-bold ${p.name_withheld ? 'text-[#9b1c1c] dark:text-[#ff9a9a]' : ''}`}
                      >
                        {p.name}
                      </span>
                      <span className="muted flex items-center gap-1.5 text-xs">
                        <PosBadge position={p.position} />
                        {covering && sideById.get(p.side_id)?.short_name}
                        <span className="lg:hidden">{summary || 'Played'}</span>
                      </span>
                    </button>
                    {p.name_withheld && (
                      <Link
                        to={`/managers/identify?player=${p.id}`}
                        className="flex min-h-[36px] items-center rounded-full bg-brand px-3 font-display text-[13px] font-extrabold uppercase text-white no-underline hover:no-underline lg:hidden"
                      >
                        Identify
                      </Link>
                    )}
                    <span className="hidden justify-center lg:flex">
                      <Stepper
                        value={l.goals}
                        label={`${p.name} goals`}
                        onChange={(v) => update(p.id, { goals: v })}
                        small
                      />
                    </span>
                    <span className="hidden justify-center lg:flex">
                      <Stepper
                        value={l.assists}
                        label={`${p.name} assists`}
                        onChange={(v) => update(p.id, { assists: v })}
                        small
                      />
                    </span>
                    <span className="hidden justify-center gap-1 lg:flex">
                      {CARDS.map(([field, label, on]) => (
                        <CardButton
                          key={field}
                          field={field}
                          label={label}
                          on={on}
                          value={l[field]}
                          player={p.name}
                          onChange={(v) => update(p.id, { [field]: v })}
                          small
                        />
                      ))}
                    </span>
                    <span className="hidden justify-center lg:flex">
                      <button
                        type="button"
                        aria-pressed={potm === p.id}
                        aria-label={`${p.name} player of the match`}
                        onClick={() => {
                          setPotm(potm === p.id ? null : p.id);
                          setDirty(true);
                        }}
                        className={`h-8 w-8 rounded-lg text-lg ${potm === p.id ? 'bg-[#fff4c2] dark:bg-[#3d3410] text-[#a07a00] dark:text-[#ffd84d] ring-2 ring-[#e0b100]' : 'text-[#c4c9d2] ring-1 ring-line'}`}
                      >
                        ★
                      </button>
                    </span>
                    <span className="min-w-[32px] text-right font-display text-xl font-extrabold">
                      {ptsFor(p)}
                    </span>
                  </div>
                  {p.name_withheld && (
                    <div className="hidden px-4 pb-2 lg:block">
                      <Link
                        to={`/managers/identify?player=${p.id}`}
                        className="text-sm font-semibold"
                      >
                        Identify this player
                      </Link>
                    </div>
                  )}
                  {/* Phone: tap a player to edit them. */}
                  {isOpen && (
                    <div className="flex flex-col gap-2.5 px-3.5 pb-3.5 pt-1 lg:hidden">
                      {(
                        [
                          ['goals', 'Goals'],
                          ['assists', 'Assists'],
                        ] as const
                      ).map(([field, label]) => (
                        <div key={field} className="flex items-center gap-2.5">
                          <span className="flex-1 text-sm font-semibold">{label}</span>
                          <Stepper
                            value={l[field]}
                            label={`${p.name} ${label.toLowerCase()}`}
                            onChange={(v) => update(p.id, { [field]: v })}
                          />
                        </div>
                      ))}
                      <div className="flex gap-2">
                        {CARDS.map(([field, label, on]) => (
                          <CardButton
                            key={field}
                            field={field}
                            label={label}
                            on={on}
                            value={l[field]}
                            player={p.name}
                            onChange={(v) => update(p.id, { [field]: v })}
                          />
                        ))}
                        <button
                          type="button"
                          aria-pressed={potm === p.id}
                          onClick={() => {
                            setPotm(potm === p.id ? null : p.id);
                            setDirty(true);
                          }}
                          className={`min-h-tap flex-1 rounded-[10px] text-[13px] font-bold ${potm === p.id ? 'bg-[#fff4c2] dark:bg-[#3d3410] ring-2 ring-[#e0b100]' : 'bg-surface ring-1 ring-line'}`}
                        >
                          ★ POTM
                        </button>
                      </div>
                      <button
                        type="button"
                        className="min-h-tap self-start text-sm font-semibold text-ink-soft"
                        onClick={() => {
                          update(p.id, { played: false });
                          if (potm === p.id) setPotm(null);
                          setOpen(null);
                        }}
                      >
                        Didn&apos;t play
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {!playedList.length && (
              <p className="muted p-4 text-sm">
                Nobody yet. Add players from Didn&apos;t play below.
              </p>
            )}
          </section>
          <p className="muted my-2 text-center text-xs lg:hidden">
            Tap a player to change goals, assists, cards or player of the match.
          </p>

          <section className={`${panel} mt-3 p-4`}>
            <h2 className="mb-2 font-display text-lg font-extrabold uppercase">Didn&apos;t play</h2>
            <p className="muted mb-2 text-xs">
              Tap anyone who played to add them to the team sheet.
            </p>
            <div className="flex flex-wrap gap-2">
              {benchList.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => update(p.id, { played: true })}
                  className="min-h-tap rounded-full bg-surface px-3 text-sm font-semibold ring-1 ring-line hover:ring-brand lg:min-h-[36px]"
                >
                  + {p.name}
                </button>
              ))}
            </div>
            {playedList.length > 0 && (
              <div className="mt-3 hidden flex-wrap gap-2 lg:flex">
                <span className="muted text-xs">Remove from the team sheet:</span>
                {playedList.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="text-xs font-semibold text-ink-soft underline"
                    onClick={() => {
                      update(p.id, { played: false });
                      if (potm === p.id) setPotm(null);
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            {others.length > 0 && (
              <label className="mt-3 block text-sm font-semibold">
                Someone from another side played
                <select
                  className="mt-1 block min-h-tap w-full max-w-md rounded-[10px] border border-line bg-surface px-2.5 text-base"
                  value=""
                  onChange={(e) => {
                    const pid = Number(e.target.value);
                    if (pid) {
                      setExtra([...extra, pid]);
                      update(pid, { played: true });
                    }
                  }}
                >
                  <option value="">Choose a player</option>
                  {others.map((p) => (
                    <option key={p.id} value={p.id}>
                      {sideById.get(p.side_id)?.short_name} · {p.name} ({p.position})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>
          {!fixture.eh_fixture_id && (
            <button
              type="button"
              className="btn btn-danger btn-sm mt-4"
              onClick={() => void remove()}
            >
              Delete match
            </button>
          )}
        </div>

        <section
          className={`${panel} overflow-hidden ${tab === 'pitchero' ? '' : 'hidden lg:block'}`}
        >
          <div className="px-4 pb-2 pt-4">
            <h2 className="m-0 font-display text-lg font-extrabold uppercase">Pitchero sheet</h2>
            <p className="muted mt-1 text-xs">
              {sheet.length
                ? unnamedHere
                  ? `"Not on EH" names are who the ${unnamedHere} withheld player(s) could be.`
                  : 'Everyone matched to England Hockey.'
                : 'No Pitchero team sheet for this match.'}
            </p>
          </div>
          {sheet.map((r) => {
            const matched = playedKeys.has(nameKey(r.name));
            return (
              <div
                key={r.name}
                className="flex min-h-[44px] items-center gap-2.5 border-t border-line px-4 text-sm"
              >
                <span className="flex-1 font-semibold">{r.name}</span>
                <span className="muted text-xs">{r.position}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${matched ? 'bg-[#e6f4ec] dark:bg-[#123d27] text-[#155c39] dark:text-[#8ee0b0]' : 'bg-[#fde8e8] dark:bg-[#4a1616] text-[#9b1c1c] dark:text-[#ff9a9a]'}`}
                >
                  {matched ? 'Matched' : 'Not on EH'}
                </span>
              </div>
            );
          })}
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface px-4 pb-6 pt-3 lg:pb-3">
        <div className="mx-auto flex max-w-[1320px] gap-2.5 lg:justify-end lg:pr-7">
          <button
            type="button"
            className="min-h-[48px] flex-1 rounded-full bg-surface font-display text-base font-extrabold uppercase ring-1 ring-line disabled:opacity-50 lg:max-w-[160px]"
            disabled={!dirty || saving}
            onClick={reset}
          >
            Undo
          </button>
          <button
            type="button"
            className="min-h-[48px] flex-[2] rounded-full bg-brand font-display text-base font-extrabold uppercase text-white disabled:opacity-60 lg:max-w-[260px]"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving' : 'Save match'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stepper({
  value,
  onChange,
  label,
  small,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  small?: boolean;
}) {
  const box = small ? 'h-9 w-9 rounded-lg text-lg' : 'h-11 w-11 rounded-[10px] text-[22px]';
  return (
    <span
      className={`flex items-center ${small ? 'gap-1' : 'gap-1.5'}`}
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        aria-label={`${label} minus one`}
        disabled={value <= 0}
        onClick={() => onChange(Math.max(0, value - 1))}
        className={`${box} bg-surface ring-1 ring-line disabled:opacity-40`}
      >
        −
      </button>
      <span
        className={`text-center font-display font-extrabold ${small ? 'w-5 text-lg' : 'w-8 text-[22px]'}`}
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={`${label} plus one`}
        onClick={() => onChange(Math.min(20, value + 1))}
        className={`${box} bg-surface ring-1 ring-line`}
      >
        +
      </button>
    </span>
  );
}

/** Tap to give a card; tap again for a second (or to clear a red). */
function CardButton({
  field,
  label,
  on,
  value,
  player,
  onChange,
  small,
}: {
  field: 'green_cards' | 'yellow_cards' | 'red_cards';
  label: string;
  on: string;
  value: number;
  player: string;
  onChange: (v: number) => void;
  small?: boolean;
}) {
  const max = field === 'red_cards' ? 1 : 2;
  return (
    <button
      type="button"
      aria-label={`${player} ${label.toLowerCase()} cards: ${value}`}
      onClick={() => onChange(value >= max ? 0 : value + 1)}
      className={`${small ? 'h-8 min-w-[38px] rounded-lg px-1 text-xs' : 'min-h-tap flex-1 rounded-[10px] text-[13px]'} font-bold ${value ? `${on} ring-2` : 'bg-surface ring-1 ring-line'}`}
    >
      {small ? label[0] : label}
      {value > 1 ? ` ×${value}` : ''}
    </button>
  );
}
