import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorText, Loading, Notices, PosBadge, PriceTrend, type Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { formatDayTime, gameweekLabel, shortName } from '@/lib/format';
import {
  keys,
  nextOpenGameweek,
  useGameweeks,
  usePlayers,
  usePriceTrend,
  useSeasonPoints,
  useSettings,
  useSides,
  useSquad,
} from '@/lib/queries';
import { POSITION_NAMES, POSITIONS, type Position } from '@/lib/scoring';
import { DEFAULT_FORMATIONS, formationOf, overflow, pitchRows } from '@/lib/formation';
import { Pitch, Shirt, type PitchSlot } from '@/components/Pitch';
import { Sheet } from '@/components/Sheet';
import { formatPrice, summariseSquad, type SquadPlayer } from '@/lib/squad';
import { errorLines, requireSupabase } from '@/lib/supabase';

export function SquadScreen() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const gameweeks = useGameweeks();
  const players = usePlayers();
  const sides = useSides();
  const settings = useSettings();
  const points = useSeasonPoints();
  const trend = usePriceTrend();

  const all = gameweeks.data ?? [];
  const gameweek = nextOpenGameweek(all);
  const previousGw = gameweek
    ? [...all].reverse().find((g) => g.start_date < gameweek.start_date)
    : undefined;
  const userId = session?.user.id;
  const current = useSquad(userId, gameweek?.id);
  const previous = useSquad(userId, previousGw?.id);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [captainId, setCaptainId] = useState<number | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<number | null>(null);
  const [sideFilter, setSideFilter] = useState('');
  const [posFilter, setPosFilter] = useState('');
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'pitch' | 'list'>('pitch');
  const [picker, setPicker] = useState<Position | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [chosenFormation, setChosenFormation] = useState<string | null>(null);

  // Start from the saved squad once it arrives.
  useEffect(() => {
    if (!gameweek || !current.data || loadedFrom === gameweek.id) return;
    setSelected(new Set(current.data.map((r) => r.player_id)));
    setCaptainId(current.data.find((r) => r.is_captain)?.player_id ?? null);
    setLoadedFrom(gameweek.id);
  }, [gameweek, current.data, loadedFrom]);

  const sideById = useMemo(() => new Map((sides.data ?? []).map((s) => [s.id, s])), [sides.data]);
  const currentIds = useMemo(() => (current.data ?? []).map((r) => r.player_id), [current.data]);
  const previousIds = useMemo(() => (previous.data ?? []).map((r) => r.player_id), [previous.data]);

  const pool: SquadPlayer[] = useMemo(
    () =>
      (players.data ?? [])
        .filter((p) => p.active || currentIds.includes(p.id))
        .map((p) => ({
          id: p.id,
          name: p.name,
          position: p.position,
          side_id: p.side_id,
          side_name: sideById.get(p.side_id)?.name ?? '',
          price: p.price,
          active: p.active,
        }))
        .sort(
          (a, b) =>
            (sideById.get(a.side_id)?.sort_order ?? 0) -
              (sideById.get(b.side_id)?.sort_order ?? 0) ||
            POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) ||
            a.name.localeCompare(b.name),
        ),
    [players.data, currentIds, sideById],
  );

  if (!session) return <Navigate to="/login" replace />;
  if (gameweeks.isLoading || players.isLoading || sides.isLoading || settings.isLoading)
    return <Loading />;
  if (players.error) return <ErrorText error={players.error} />;
  if (!gameweek) {
    return (
      <>
        <h1>Pick your squad</h1>
        <p className="muted">
          There&apos;s no upcoming gameweek yet. A manager needs to sync or add fixtures.
        </p>
      </>
    );
  }
  const s = settings.data!;
  const picked = pool.filter((p) => selected.has(p.id));
  const summary = summariseSquad(picked, captainId, s, currentIds, previousIds);

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
      if (captainId === id) setCaptainId(null);
    } else next.add(id);
    setSelected(next);
  }

  async function save() {
    setSaving(true);
    const { error } = await requireSupabase().rpc('save_squad', {
      p_player_ids: [...selected],
      p_captain_id: captainId ?? 0,
    });
    setSaving(false);
    if (error) {
      setNotices(errorLines(error).map((text) => ({ kind: 'error', text })));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['squad'] });
    await queryClient.invalidateQueries({ queryKey: keys.table });
    navigate('/dashboard');
  }

  const visible = pool.filter(
    (p) =>
      (!sideFilter || String(p.side_id) === sideFilter) &&
      (!posFilter || p.position === posFilter) &&
      (!onlyPicked || selected.has(p.id)),
  );

  const allowed = s.formations.length ? s.formations : DEFAULT_FORMATIONS;
  const pickedShape = formationOf(summary.byPosition);
  // Start from the saved squad's shape, or the first allowed formation.
  const formation = chosenFormation ?? (allowed.includes(pickedShape) ? pickedShape : allowed[0]!);
  const rows = pitchRows(picked, formation);
  const extra = overflow(summary.byPosition, formation);
  const bank = s.budget - summary.cost;
  const slots = Object.fromEntries(
    POSITIONS.map((pos) => [
      pos,
      rows[pos].map((p, i): PitchSlot =>
        p
          ? {
              key: `p${p.id}`,
              position: pos,
              name: shortName(p.name),
              sub: sideById.get(p.side_id)?.short_name ?? '',
              captain: captainId === p.id,
              onClick: () => setFocus(p.id),
            }
          : { key: `${pos}${i}`, position: pos, name: null, onClick: () => setPicker(pos) },
      ),
    ]),
  ) as Record<Position, PitchSlot[]>;
  const focused = pool.find((p) => p.id === focus);
  const choices = picker
    ? pool
        .filter((p) => p.position === picker && !selected.has(p.id) && p.active)
        .filter((p) => !sideFilter || String(p.side_id) === sideFilter)
        .sort(
          (a, b) =>
            (points.data?.get(b.id) ?? 0) - (points.data?.get(a.id) ?? 0) || b.price - a.price,
        )
    : [];

  return (
    <>
      <section className="hero">
        <p className="font-display text-sm font-bold uppercase tracking-widest text-white/80">
          Pick your squad
        </p>
        <h1 className="mb-1 mt-0 text-4xl">{gameweekLabel(gameweek, all)}</h1>
        <p className="text-sm text-white/85">Deadline {formatDayTime(gameweek.deadline)}</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white/15 px-2 py-2">
            <span className="display-num block text-2xl">
              {summary.count}/{s.squad_size}
            </span>
            <span className="text-xs uppercase tracking-wide text-white/80">Players</span>
          </div>
          <div className="rounded-xl bg-white/15 px-2 py-2">
            <span className={`display-num block text-2xl ${bank < 0 ? 'text-[#ffd0d0]' : ''}`}>
              {formatPrice(bank)}m
            </span>
            <span className="text-xs uppercase tracking-wide text-white/80">Bank</span>
          </div>
          <div className="rounded-xl bg-white/15 px-2 py-2">
            <span className="display-num block text-2xl">
              {summary.transfers === null
                ? 'Free'
                : `${summary.transfers}/${s.transfers_per_gameweek}`}
            </span>
            <span className="text-xs uppercase tracking-wide text-white/80">Transfers</span>
          </div>
        </div>
      </section>

      <Notices items={notices} />

      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="inline-flex rounded-full bg-surface p-1 shadow-card" role="tablist">
          {(['pitch', 'list'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`min-h-[36px] rounded-full px-4 font-display text-sm font-bold uppercase ${view === v ? 'bg-brand text-white' : 'text-ink-soft'}`}
            >
              {v === 'pitch' ? 'Pitch view' : 'List view'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn hidden sm:inline-flex"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving' : 'Save squad'}
        </button>
      </div>

      {summary.problems.length > 0 && selected.size > 0 && (
        <ul className="muted mb-3 list-disc pl-5 text-sm">
          {summary.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {view === 'pitch' ? (
        <>
          <div
            className="mb-3 flex gap-2 overflow-x-auto pb-1"
            role="radiogroup"
            aria-label="Formation"
          >
            {allowed.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={formation === f}
                onClick={() => setChosenFormation(f)}
                className={`min-h-[40px] shrink-0 rounded-full px-4 font-display text-lg font-extrabold tabular-nums ${formation === f ? 'bg-[#16181d] text-white' : 'bg-surface text-ink-soft shadow-card'}`}
              >
                {f}
              </button>
            ))}
          </div>
          {Object.keys(extra).length > 0 && (
            <p className="mb-3 rounded-xl border border-brand/40 bg-brand/5 px-3 py-2 text-sm font-semibold">
              To play {formation}, remove{' '}
              {Object.entries(extra)
                .map(([pos, n]) => `${n} ${pos}`)
                .join(' and ')}
              . Tap a player to remove or swap them.
            </p>
          )}
          <Pitch rows={slots} />
          <p className="muted mt-3 text-center text-sm">
            Tap an empty shirt to add a player, or a player to make them captain or swap them.
          </p>
        </>
      ) : (
        <>
          <div className="my-3 flex flex-wrap items-center gap-2">
            <select
              className="input-inline"
              aria-label="Filter by side"
              value={sideFilter}
              onChange={(e) => setSideFilter(e.target.value)}
            >
              <option value="">All sides</option>
              {(sides.data ?? []).map((side) => (
                <option key={side.id} value={side.id}>
                  {side.name}
                </option>
              ))}
            </select>
            <select
              className="input-inline"
              aria-label="Filter by position"
              value={posFilter}
              onChange={(e) => setPosFilter(e.target.value)}
            >
              <option value="">All positions</option>
              {POSITIONS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyPicked}
                onChange={(e) => setOnlyPicked(e.target.checked)}
              />{' '}
              Only my picks
            </label>
          </div>
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th>Pick</th>
                  <th>Captain</th>
                  <th>Player</th>
                  <th>Pos</th>
                  <th>Side</th>
                  <th className="num">Price</th>
                  <th className="num">Pts</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const isPicked = selected.has(p.id);
                  return (
                    <tr key={p.id} className={isPicked ? 'bg-brand/5' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-[#d91414]"
                          aria-label={`Pick ${p.name}`}
                          checked={isPicked}
                          onChange={() => toggle(p.id)}
                        />
                      </td>
                      <td>
                        <input
                          type="radio"
                          name="captain"
                          className="h-5 w-5 accent-[#d91414]"
                          aria-label={`Captain ${p.name}`}
                          disabled={!isPicked}
                          checked={captainId === p.id}
                          onChange={() => setCaptainId(p.id)}
                        />
                      </td>
                      <td>
                        {p.name}
                        {!p.active && <span className="muted"> (unavailable)</span>}
                      </td>
                      <td>
                        <PosBadge position={p.position} />
                      </td>
                      <td>{sideById.get(p.side_id)?.short_name}</td>
                      <td className="num">
                        {formatPrice(p.price)}
                        <PriceTrend change={trend.data?.get(p.id)} />
                      </td>
                      <td className="num">{points.data?.get(p.id) ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Save stays in reach above the tab bar on phones. */}
      <div className="fixed inset-x-0 bottom-16 z-20 px-4 pb-[env(safe-area-inset-bottom)] sm:hidden">
        <button
          type="button"
          className="btn w-full shadow-lg"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving' : 'Save squad'}
        </button>
      </div>
      <div className="h-16 sm:hidden" />

      {picker && (
        <Sheet
          title={`Choose a ${POSITION_NAMES[picker].toLowerCase()}`}
          onClose={() => setPicker(null)}
        >
          <div className="mb-2 flex items-center justify-between gap-2 text-sm">
            <select
              className="input-inline"
              aria-label="Filter by side"
              value={sideFilter}
              onChange={(e) => setSideFilter(e.target.value)}
            >
              <option value="">All sides</option>
              {(sides.data ?? []).map((side) => (
                <option key={side.id} value={side.id}>
                  {side.name}
                </option>
              ))}
            </select>
            <span className="muted">Bank {formatPrice(bank)}m</span>
          </div>
          <ul className="divide-y divide-line">
            {choices.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex min-h-[56px] w-full items-center gap-3 text-left"
                  onClick={() => {
                    toggle(p.id);
                    setPicker(null);
                  }}
                >
                  <Shirt keeper={p.position === 'GK'} className="h-9 w-9 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.name}</span>
                    <span className="muted text-xs">{sideById.get(p.side_id)?.name}</span>
                  </span>
                  <span className="text-right">
                    <span
                      className={`display-num block text-lg ${p.price > bank ? 'text-brand' : ''}`}
                    >
                      {formatPrice(p.price)}m
                      <PriceTrend change={trend.data?.get(p.id)} />
                    </span>
                    <span className="muted text-xs">{points.data?.get(p.id) ?? 0} pts</span>
                  </span>
                </button>
              </li>
            ))}
            {!choices.length && <li className="muted py-4">No more players in this position.</li>}
          </ul>
        </Sheet>
      )}

      {focused && (
        <Sheet title={focused.name} onClose={() => setFocus(null)}>
          <div className="mb-4 flex items-center gap-3">
            <Shirt keeper={focused.position === 'GK'} className="h-14 w-14" />
            <div>
              <p className="font-semibold">
                {POSITION_NAMES[focused.position]} · {sideById.get(focused.side_id)?.name}
              </p>
              <p className="muted text-sm">
                {formatPrice(focused.price)}m · {points.data?.get(focused.id) ?? 0} pts this season
              </p>
            </div>
          </div>
          <div className="grid gap-2">
            <button
              type="button"
              className="btn"
              disabled={captainId === focused.id}
              onClick={() => {
                setCaptainId(focused.id);
                setFocus(null);
              }}
            >
              {captainId === focused.id ? 'Captain' : 'Make captain'}
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                toggle(focused.id);
                setFocus(null);
                setPicker(focused.position);
              }}
            >
              Swap for another {focused.position}
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                toggle(focused.id);
                setFocus(null);
              }}
            >
              Remove
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
