import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loading, Notices, type Notice } from '@/components/ui';
import { formByPlayer } from '@/lib/form';
import { needsPosition, playersFilter, type PlayerFilter } from '@/lib/managers';
import { parsePlayerLines } from '@/lib/players';
import {
  keys,
  useAllGameweekPoints,
  useGameweeks,
  usePlayers,
  useSeasonPoints,
  useSides,
  type Player,
  type Side,
} from '@/lib/queries';
import { POSITIONS, type Position } from '@/lib/scoring';
import { formatPrice, parsePrice } from '@/lib/squad';
import { errorLines, requireSupabase } from '@/lib/supabase';
import { Chip, ChipRow, PageHead, POSITION_BUTTON, SideTag, Toggle, panel } from './adminUi';
import { useManagerStatus } from './status';

const FILTERS: [PlayerFilter, string][] = [
  ['position', 'Needs position'],
  ['withheld', 'Withheld'],
  ['suggested', 'Pitchero suggestions'],
  ['inactive', 'Inactive'],
  ['all', 'All'],
];

export function PlayersScreen() {
  const players = usePlayers();
  const sides = useSides();
  const points = useSeasonPoints();
  const gameweeks = useGameweeks();
  const gwPoints = useAllGameweekPoints();
  const status = useManagerStatus();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [side, setSide] = useState<number | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  if (players.isLoading || sides.isLoading) return <Loading />;

  const filter = (params.get('filter') as PlayerFilter | null) ?? 'position';
  const setFilter = (f: PlayerFilter) => {
    setParams(f === 'position' ? {} : { filter: f }, { replace: true });
    setSelected(new Set());
  };
  const all = players.data ?? [];
  const sideList = sides.data ?? [];
  const sideById = new Map(sideList.map((s) => [s.id, s]));
  const order = (gameweeks.data ?? []).map((g) => g.id);
  const form = formByPlayer(gwPoints.data ?? [], order, 5);
  const suggestion = status.positionSuggestions;
  const active = all.filter((p) => p.active && !p.needs_review);
  const count = (f: PlayerFilter) =>
    all.filter((p) => playersFilter(p, f, suggestion.has(p.id))).length;
  const sortOrder = new Map(sideList.map((s) => [s.id, s.sort_order]));
  const list = all
    .filter(
      (p) =>
        playersFilter(p, filter, suggestion.has(p.id)) &&
        (!side || p.side_id === side) &&
        (!pos || p.position === pos) &&
        (!search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())),
    )
    .sort(
      (a, b) =>
        (sortOrder.get(a.side_id) ?? 0) - (sortOrder.get(b.side_id) ?? 0) ||
        a.name.localeCompare(b.name),
    );

  const fail = (error: unknown) =>
    setNotices(errorLines(error).map((text) => ({ kind: 'error', text })));
  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: keys.players });
  }

  /** Set a position for one or many; new players become pickable. */
  async function setPosition(ids: number[], position: Position) {
    setBusy(true);
    const db = requireSupabase();
    const fresh = all.filter((p) => ids.includes(p.id) && p.needs_review).map((p) => p.id);
    const results = await Promise.all([
      db.from('players').update({ position, position_confirmed: true }).in('id', ids),
      fresh.length
        ? db.from('players').update({ active: true, needs_review: false }).in('id', fresh)
        : Promise.resolve({ error: null }),
    ]);
    setBusy(false);
    const failed = results.find((r) => r.error);
    if (failed?.error) fail(failed.error);
    else if (ids.length > 1)
      setNotices([{ kind: 'success', text: `${ids.length} players set to ${position}.` }]);
    setSelected(new Set());
    await refresh();
  }

  async function setActive(ids: number[], value: boolean) {
    setBusy(true);
    const { error } = await requireSupabase()
      .from('players')
      .update({ active: value, ...(value ? { needs_review: false } : {}) })
      .in('id', ids);
    setBusy(false);
    if (error) fail(error);
    setSelected(new Set());
    await refresh();
  }

  /** Pitchero has it wrong: keep the position and stop suggesting. */
  async function reject(ids: number[]) {
    setBusy(true);
    const { error } = await requireSupabase()
      .from('players')
      .update({ position_confirmed: true })
      .in('id', ids);
    setBusy(false);
    if (error) fail(error);
    await refresh();
  }

  async function acceptAll() {
    const byPosition = new Map<Position, number[]>();
    for (const p of list) {
      const s = suggestion.get(p.id);
      if (s) byPosition.set(s.position, [...(byPosition.get(s.position) ?? []), p.id]);
    }
    for (const [position, ids] of byPosition) await setPosition(ids, position);
    setNotices([{ kind: 'success', text: 'Pitchero positions applied.' }]);
  }

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const counts = POSITIONS.map((p) => `${active.filter((x) => x.position === p).length} ${p}`).join(
    ', ',
  );
  const select =
    'min-h-tap rounded-[10px] border border-line bg-surface px-2.5 text-[15px] lg:min-h-[40px]';

  return (
    <>
      <PageHead title="Players" sub={`${active.length} active · ${counts}`}>
        <button
          type="button"
          className="min-h-tap rounded-full bg-surface px-4 font-display text-[15px] font-extrabold uppercase ring-1 ring-line lg:min-h-[40px]"
          onClick={() => setAdding(!adding)}
        >
          {adding ? 'Close' : 'Add players'}
        </button>
      </PageHead>
      <Notices items={notices} />
      {adding && <AddPlayers sides={sideList} onDone={setNotices} />}

      <div className="mb-3 flex flex-col gap-2.5 lg:flex-row lg:flex-wrap lg:items-center">
        <input
          type="search"
          placeholder="Search by name"
          aria-label="Search"
          className="min-h-tap rounded-[10px] border border-line bg-surface px-3 text-base lg:min-h-[40px] lg:w-[220px]"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ChipRow>
          {FILTERS.map(([key, label]) => (
            <Chip key={key} on={filter === key} onClick={() => setFilter(key)}>
              {label}
              {key !== 'all' ? ` (${count(key)})` : ''}
            </Chip>
          ))}
        </ChipRow>
        <div className="hidden flex-1 lg:block" />
        <div className="flex gap-2">
          <select
            aria-label="Side"
            className={`${select} flex-1`}
            value={side ?? ''}
            onChange={(e) => setSide(Number(e.target.value) || null)}
          >
            <option value="">All sides</option>
            {sideList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.short_name}
              </option>
            ))}
          </select>
          <select
            aria-label="Position"
            className={`${select} flex-1`}
            value={pos ?? ''}
            onChange={(e) => setPos((e.target.value || null) as Position | null)}
          >
            <option value="">All positions</option>
            {POSITIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>

      {filter === 'suggested' && list.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => void acceptAll()}
          >
            Accept all {list.filter((p) => suggestion.has(p.id)).length}
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="sticky top-[72px] z-10 mb-3 hidden items-center gap-2.5 rounded-xl bg-[#16181d] py-2 pl-4 pr-2 text-white lg:flex">
          <span className="text-[15px] font-bold">{selected.size} selected</span>
          <span className="flex-1" />
          <span className="text-[13px] text-white/70">Set position</span>
          {POSITIONS.map((p) => (
            <button
              key={p}
              type="button"
              disabled={busy}
              onClick={() => void setPosition([...selected], p)}
              className="min-h-[36px] min-w-[52px] rounded-lg bg-white/10 font-display text-[15px] font-extrabold hover:bg-white/20"
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => void setActive([...selected], false)}
            className="min-h-[36px] rounded-lg bg-white/10 px-3 text-[13px] font-bold hover:bg-white/20"
          >
            Mark inactive
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="min-h-[36px] px-3 text-[13px] font-bold text-white/70"
          >
            Clear
          </button>
        </div>
      )}

      {/* Laptop: a table. */}
      <section className={`${panel} hidden overflow-hidden lg:block`}>
        <div className="grid grid-cols-[28px_1fr_54px_220px_70px_56px_56px_240px] items-center gap-3 border-b border-[#e3e6eb] px-[18px] py-3 text-xs font-bold uppercase tracking-wider text-ink-soft">
          <input
            type="checkbox"
            aria-label="Select all"
            className="h-5 w-5 accent-[#d91414]"
            checked={list.length > 0 && list.every((p) => selected.has(p.id))}
            onChange={(e) =>
              setSelected(e.target.checked ? new Set(list.map((p) => p.id)) : new Set())
            }
          />
          <span>Name</span>
          <span>Side</span>
          <span>Position</span>
          <span className="text-right">Price</span>
          <span className="text-right">Pts</span>
          <span className="text-right">Form</span>
          <span>Pitchero suggests</span>
        </div>
        {list.map((p) => (
          <PlayerRow
            key={p.id}
            player={p}
            side={sideById.get(p.side_id)}
            sides={sideList}
            points={points.data?.get(p.id) ?? 0}
            form={form.get(p.id)}
            suggested={suggestion.get(p.id)?.position}
            evidence={suggestion.get(p.id)?.evidence}
            selected={selected.has(p.id)}
            busy={busy}
            onSelect={() => toggle(p.id)}
            onPosition={(position) => void setPosition([p.id], position)}
            onReject={() => void reject([p.id])}
            onError={fail}
            onSaved={refresh}
          />
        ))}
      </section>

      {/* Phone: cards with one-tap positions. */}
      <div className="flex flex-col gap-3 lg:hidden">
        {list.map((p) => (
          <PlayerCard
            key={p.id}
            player={p}
            side={sideById.get(p.side_id)}
            sides={sideList}
            points={points.data?.get(p.id) ?? 0}
            suggested={suggestion.get(p.id)?.position}
            busy={busy}
            onPosition={(position) => void setPosition([p.id], position)}
            onReject={() => void reject([p.id])}
            onError={fail}
            onSaved={refresh}
          />
        ))}
      </div>

      {!list.length && (
        <p className={`${panel} p-5 font-semibold`}>
          {filter === 'position' ? 'Every player has a position.' : 'No players match.'}
        </p>
      )}
      <p className="muted mt-3 text-[13px]">
        One tap sets a position and saves. A squad that no longer fits 2 GK, 5 DEF, 5 MID, 3 FWD
        gets a free fix next time its owner saves.
      </p>
    </>
  );
}

function PositionButtons({
  player,
  busy,
  onPosition,
}: {
  player: Player;
  busy: boolean;
  onPosition: (p: Position) => void;
}) {
  // A position nobody has set yet shows as a suggestion, not a choice.
  const unset = needsPosition(player);
  return (
    <div
      className="grid grid-cols-4 gap-1.5 lg:flex lg:gap-1"
      role="group"
      aria-label={`Position for ${player.name}`}
    >
      {POSITIONS.map((pos) => {
        const current = player.position === pos;
        return (
          <button
            key={pos}
            type="button"
            disabled={busy}
            aria-pressed={current && !unset}
            onClick={() => onPosition(pos)}
            className={`${POSITION_BUTTON} ${current ? (unset ? 'bg-[#fff1dc] text-[#7a4600] ring-1 ring-[#e8b46a]' : 'bg-[#16181d] text-white') : 'bg-surface text-ink ring-1 ring-line hover:ring-ink'}`}
          >
            {pos}
          </button>
        );
      })}
    </div>
  );
}

interface RowProps {
  player: Player;
  side: Side | undefined;
  sides: Side[];
  points: number;
  suggested: Position | undefined;
  busy: boolean;
  onPosition: (p: Position) => void;
  onReject: () => void;
  onError: (e: unknown) => void;
  onSaved: () => Promise<void>;
}

function note(p: Player): string {
  if (p.needs_review) return 'New from England Hockey';
  if (p.name_withheld) return 'Name withheld, identify them';
  if (!p.active) return 'Inactive';
  if (needsPosition(p)) return 'Midfield by default, never set';
  return '';
}

function PlayerRow(
  props: RowProps & {
    form: number | undefined;
    evidence: string | undefined;
    selected: boolean;
    onSelect: () => void;
  },
) {
  const { player: p, side, suggested } = props;
  const [editing, setEditing] = useState(false);
  return (
    <div className={`border-b border-[#eef0f3] ${props.selected ? 'bg-[#fff5f5]' : ''}`}>
      <div className="grid min-h-[52px] grid-cols-[28px_1fr_54px_220px_70px_56px_56px_240px] items-center gap-3 px-[18px] py-1.5">
        <input
          type="checkbox"
          aria-label={`Select ${p.name}`}
          className="h-5 w-5 accent-[#d91414]"
          checked={props.selected}
          onChange={props.onSelect}
        />
        <button type="button" className="min-w-0 text-left" onClick={() => setEditing(!editing)}>
          <span
            className={`block truncate text-[15px] font-semibold ${p.name_withheld ? 'text-[#9b1c1c]' : ''}`}
          >
            {p.name}
          </span>
          <span className="muted block text-xs">{note(p) || 'Edit'}</span>
        </button>
        <SideTag>{side?.short_name}</SideTag>
        <PositionButtons player={p} busy={props.busy} onPosition={props.onPosition} />
        <span className="text-right text-[15px]">{formatPrice(p.price)}</span>
        <span className="text-right font-display text-lg font-extrabold">{props.points}</span>
        <span className="text-right text-sm text-ink-soft">{props.form ?? '-'}</span>
        <span className="flex items-center gap-1.5">
          {suggested && (
            <>
              <span
                title={props.evidence}
                className="rounded-full bg-[#e3f0f9] px-2.5 py-0.5 text-[13px] font-bold text-[#1d5f8c]"
              >
                {suggested}
              </span>
              <button
                type="button"
                disabled={props.busy}
                onClick={() => props.onPosition(suggested)}
                className="min-h-[32px] rounded-full bg-[#1f7a4d] px-2.5 text-xs font-bold text-white"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={props.busy}
                onClick={props.onReject}
                className="min-h-[32px] rounded-full bg-surface px-2.5 text-xs font-bold ring-1 ring-line"
              >
                Reject
              </button>
            </>
          )}
        </span>
      </div>
      {editing && <EditPlayer {...props} onClose={() => setEditing(false)} />}
    </div>
  );
}

function PlayerCard(props: RowProps) {
  const { player: p, side, suggested } = props;
  const [editing, setEditing] = useState(false);
  return (
    <div className={`${panel} flex flex-col gap-2.5 px-3.5 py-3`}>
      <button
        type="button"
        className="flex items-center gap-2.5 text-left"
        aria-expanded={editing}
        onClick={() => setEditing(!editing)}
      >
        <SideTag>{side?.short_name}</SideTag>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-base font-bold ${p.name_withheld ? 'text-[#9b1c1c]' : ''}`}
          >
            {p.name}
          </span>
          <span className="muted block text-xs">
            {formatPrice(p.price)} · {props.points} pts{note(p) ? ` · ${note(p)}` : ''}
          </span>
        </span>
        <span className="text-xl text-[#8a909b]" aria-hidden="true">
          {editing ? '⌃' : '›'}
        </span>
      </button>
      <PositionButtons player={p} busy={props.busy} onPosition={props.onPosition} />
      {suggested && (
        <div className="flex items-center gap-2 rounded-[10px] bg-[#eef6fc] py-1.5 pl-3 pr-1.5">
          <span className="flex-1 text-[13px] font-semibold text-[#1d5f8c]">
            Pitchero says {suggested}
          </span>
          <button
            type="button"
            disabled={props.busy}
            onClick={() => props.onPosition(suggested)}
            className="min-h-[40px] rounded-full bg-[#1f7a4d] px-3.5 text-[13px] font-bold text-white"
          >
            Accept
          </button>
          <button
            type="button"
            disabled={props.busy}
            onClick={props.onReject}
            className="min-h-[40px] rounded-full bg-surface px-3.5 text-[13px] font-bold ring-1 ring-line"
          >
            Reject
          </button>
        </div>
      )}
      {editing && <EditPlayer {...props} onClose={() => setEditing(false)} />}
    </div>
  );
}

/** Name, side, price and active: the rarer changes, behind a tap. */
function EditPlayer({
  player: p,
  sides,
  onError,
  onSaved,
  onClose,
}: RowProps & { onClose: () => void }) {
  const [row, setRow] = useState({
    name: p.name,
    side_id: p.side_id,
    priceText: formatPrice(p.price),
    active: p.active,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    const price = parsePrice(row.priceText);
    if (price === null || !row.name.trim()) {
      onError({ message: 'Name and a price like 7.5 are required.' });
      return;
    }
    setSaving(true);
    const { error } = await requireSupabase()
      .from('players')
      .update({
        name: row.name.trim(),
        side_id: row.side_id,
        price,
        active: row.active,
        ...(row.active ? { needs_review: false } : {}),
      })
      .eq('id', p.id);
    setSaving(false);
    if (error) onError(error);
    else {
      await onSaved();
      onClose();
    }
  }

  const input =
    'mt-1 block min-h-tap w-full rounded-[10px] border border-line bg-surface px-2.5 text-base';
  return (
    <div className="grid grid-cols-2 gap-2.5 border-t border-[#eef0f3] pt-3 lg:grid-cols-[1fr_120px_120px_auto_auto] lg:items-end lg:px-[18px] lg:pb-3 lg:pl-[58px]">
      <label className="col-span-2 text-xs font-bold uppercase text-ink-soft lg:col-span-1">
        Name
        <input
          className={input}
          value={row.name}
          onChange={(e) => setRow({ ...row, name: e.target.value })}
        />
      </label>
      <label className="text-xs font-bold uppercase text-ink-soft">
        Side
        <select
          className={input}
          value={row.side_id}
          onChange={(e) => setRow({ ...row, side_id: Number(e.target.value) })}
        >
          {sides.map((s) => (
            <option key={s.id} value={s.id}>
              {s.short_name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-bold uppercase text-ink-soft">
        Price (m)
        <input
          className={input}
          inputMode="decimal"
          value={row.priceText}
          onChange={(e) => setRow({ ...row, priceText: e.target.value })}
        />
      </label>
      <span className="flex items-center gap-1 text-sm font-semibold">
        <Toggle
          checked={row.active}
          label="Active"
          onChange={(v) => setRow({ ...row, active: v })}
        />
        Active
      </span>
      <span className="flex gap-2">
        <button type="button" className="btn btn-sm" disabled={saving} onClick={() => void save()}>
          Save
        </button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={onClose}>
          Cancel
        </button>
      </span>
    </div>
  );
}

function AddPlayers({ sides, onDone }: { sides: Side[]; onDone: (n: Notice[]) => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    const { rows, problems } = parsePlayerLines(text, sides);
    const out: Notice[] = problems.map((t) => ({ kind: 'error', text: t }));
    if (rows.length) {
      const { error } = await requireSupabase().from('players').insert(rows);
      if (error) out.unshift(...errorLines(error).map((t): Notice => ({ kind: 'error', text: t })));
      else {
        out.unshift({ kind: 'success', text: `Added ${rows.length} player(s).` });
        setText('');
        await queryClient.invalidateQueries({ queryKey: keys.players });
      }
    }
    onDone(out);
  }

  return (
    <section className={`${panel} mb-4 p-4`}>
      <h2 className="mb-1 font-display text-xl font-extrabold uppercase">Add players</h2>
      <p className="muted mb-2 text-sm">
        One per line: <code>Name, Position, Side, Price</code>. Position is GK, DEF, MID or FWD.
        Side is {sides.map((s) => s.short_name).join(', ')}.
      </p>
      <form onSubmit={(e) => void add(e)}>
        <textarea
          className="input min-h-[120px] py-2"
          aria-label="Players to add"
          placeholder={'Jo Bloggs, MID, M1, 8.5\nSam Smith, GK, W2, 6.0'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn mt-2">Add</button>
      </form>
    </section>
  );
}
