import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorText, Loading, Notices, PosBadge, PriceTrend, type Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { formatWeekdayTime, gameweekLabel, shortName } from '@/lib/format';
import {
  keys,
  nextOpenGameweek,
  useGameweeks,
  usePlayers,
  usePriceTrend,
  useSeasonPoints,
  useSettings,
  useSides,
  useAllGameweekPoints,
  useChips,
  useFixtures,
  useSquad,
  lockedGameweeks,
} from '@/lib/queries';
import { fixtureLabel, formByPlayer } from '@/lib/form';
import { ChipsCard } from './ChipsCard';
import { POSITION_NAMES, POSITIONS, type Position } from '@/lib/scoring';
import { DEFAULT_FORMATIONS, formationOf, overflow, pitchRows } from '@/lib/formation';
import { Pitch, Shirt, type PitchSlot } from '@/components/Pitch';
import { Sheet } from '@/components/Sheet';
import { PlayerDetail, PlayerSheet } from '@/features/player/PlayerDetail';
import { BENCH, formatPrice, STARTERS, summariseSquad, type SquadPlayer } from '@/lib/squad';
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
  // Bank going into this gameweek, before this week's sales and buys.
  const bankBefore = useQuery({
    queryKey: ['bank-before', session?.user.id ?? ''],
    enabled: Boolean(session),
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('bank_before_next');
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const all = gameweeks.data ?? [];
  const gameweek = nextOpenGameweek(all);
  // The last gameweek with points, for "how did they do" in player details.
  const lastPlayed = [...all].reverse().find((g) => new Date(g.deadline) <= new Date());
  const previousGw = gameweek
    ? [...all].reverse().find((g) => g.start_date < gameweek.start_date)
    : undefined;
  const userId = session?.user.id;
  const current = useSquad(userId, gameweek?.id);
  const previous = useSquad(userId, previousGw?.id);
  const chips = useChips(userId);
  const fixtures = useFixtures();
  const gameweekPoints = useAllGameweekPoints();
  // Average over each player's last 3 games, finished gameweeks only.
  const form = useMemo(
    () =>
      formByPlayer(
        gameweekPoints.data ?? [],
        lockedGameweeks(gameweeks.data ?? []).map((g) => g.id),
      ),
    [gameweekPoints.data, gameweeks.data],
  );
  const wildcard = Boolean(
    gameweek && chips.data?.some((c) => c.chip === 'wildcard' && c.gameweek_id === gameweek.id),
  );

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [captainId, setCaptainId] = useState<number | null>(null);
  const [viceId, setViceId] = useState<number | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<number | null>(null);
  const [sideFilter, setSideFilter] = useState('');
  const [posFilter, setPosFilter] = useState('');
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'pitch' | 'list'>('pitch');
  // Choosing a player: for a pitch position, or for a bench slot (0 = sub keeper).
  const [picker, setPicker] = useState<{ positions: Position[]; slot?: number } | null>(null);
  // Subs bench: [sub keeper, sub 1, sub 2, sub 3].
  const [bench, setBench] = useState<(number | null)[]>([null, null, null, null]);
  // A player tapped for "swap with": the next player tapped trades places.
  const [swapFrom, setSwapFrom] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [statsFor, setStatsFor] = useState<number | null>(null);
  const [chosenFormation, setChosenFormation] = useState<string | null>(null);

  // Start from the saved squad once it arrives.
  useEffect(() => {
    if (!gameweek || !current.data || loadedFrom === gameweek.id) return;
    setSelected(
      new Set(current.data.filter((r) => r.bench_order === null).map((r) => r.player_id)),
    );
    const subs: (number | null)[] = [null, null, null, null];
    for (const r of current.data) if (r.bench_order) subs[r.bench_order - 1] = r.player_id;
    setBench(subs);
    setCaptainId(current.data.find((r) => r.is_captain)?.player_id ?? null);
    setViceId(current.data.find((r) => r.is_vice)?.player_id ?? null);
    setLoadedFrom(gameweek.id);
  }, [gameweek, current.data, loadedFrom]);

  const sideById = useMemo(() => new Map((sides.data ?? []).map((s) => [s.id, s])), [sides.data]);
  const currentIds = useMemo(() => (current.data ?? []).map((r) => r.player_id), [current.data]);
  const currentStarters = useMemo(
    () => (current.data ?? []).filter((r) => r.bench_order === null).map((r) => r.player_id),
    [current.data],
  );
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
  const poolById = new Map(pool.map((p) => [p.id, p]));
  const benchPlayers = bench.map((id) => (id === null ? null : (poolById.get(id) ?? null)));
  const priceById = new Map((players.data ?? []).map((p) => [p.id, p.price]));
  const summary = summariseSquad(
    picked,
    benchPlayers,
    captainId,
    viceId,
    // A wildcard lifts the transfer limit (as in save_squad).
    wildcard ? { ...s, transfers_per_gameweek: Infinity } : s,
    currentIds,
    previousIds,
    { base: bankBefore.data ?? s.budget, priceOf: (id) => priceById.get(id) ?? 0 },
    currentStarters,
  );
  const inSquad = (id: number) => selected.has(id) || bench.includes(id);
  const isKeeper = (id: number) => poolById.get(id)?.position === 'GK';
  // Who the player's side plays in the gameweek being picked.
  const nextFor = (p: SquadPlayer) => fixtureLabel(fixtures.data ?? [], p.side_id, gameweek.id);
  const formFor = (id: number) => form.get(id)?.toFixed(1) ?? '-';
  const benchSlot = (id: number) => bench.indexOf(id);

  /** Add to the starting 11 if there's room, else the first fitting bench slot. */
  function add(id: number, slot?: number) {
    if (slot !== undefined) {
      const next = [...bench];
      next[slot] = id;
      setBench(next);
      return;
    }
    if (selected.size < STARTERS) {
      setSelected(new Set([...selected, id]));
      return;
    }
    const free = isKeeper(id)
      ? bench[0] === null
        ? 0
        : -1
      : bench.findIndex((b, i) => i > 0 && b === null);
    if (free < 0) {
      setNotices([{ kind: 'error', text: 'Your squad is full. Remove someone first.' }]);
      return;
    }
    add(id, free);
  }

  function remove(id: number) {
    if (selected.has(id)) {
      const next = new Set(selected);
      next.delete(id);
      setSelected(next);
      if (captainId === id) setCaptainId(null);
      if (viceId === id) setViceId(null);
    } else if (bench.includes(id)) {
      setBench(bench.map((b) => (b === id ? null : b)));
    }
  }

  /** Captain and vice swap roles if one is given the other's armband. */
  function makeCaptain(id: number) {
    if (viceId === id) setViceId(captainId);
    setCaptainId(id);
  }
  function makeVice(id: number) {
    if (captainId === id) setCaptainId(viceId);
    setViceId(id);
  }

  function toggle(id: number) {
    if (inSquad(id)) remove(id);
    else add(id);
  }

  /** Can a and b trade places? Keepers only swap with keepers. */
  function canSwap(a: number, b: number) {
    if (a === b || isKeeper(a) !== isKeeper(b)) return false;
    return !(selected.has(a) && selected.has(b));
  }

  function swap(a: number, b: number) {
    setSwapFrom(null);
    if (!canSwap(a, b)) return;
    if (selected.has(a) || selected.has(b)) {
      const [starter, sub] = selected.has(a) ? [a, b] : [b, a];
      const next = new Set(selected);
      next.delete(starter);
      next.add(sub);
      setSelected(next);
      setBench(bench.map((x) => (x === sub ? starter : x)));
      if (captainId === starter) setCaptainId(sub);
      if (viceId === starter) setViceId(sub);
    } else {
      // Two subs: change the bench order.
      setBench(bench.map((x) => (x === a ? b : x === b ? a : x)));
    }
    setChosenFormation(null);
  }

  /** Move a sub into an empty pitch slot, or a starter into an empty bench slot. */
  function moveTo(id: number, slot: { position?: Position; bench?: number }) {
    setSwapFrom(null);
    if (slot.position && bench.includes(id) && poolById.get(id)?.position === slot.position) {
      setBench(bench.map((x) => (x === id ? null : x)));
      setSelected(new Set([...selected, id]));
      return true;
    }
    if (slot.bench !== undefined && selected.has(id) && (slot.bench === 0) === isKeeper(id)) {
      const next = new Set(selected);
      next.delete(id);
      setSelected(next);
      const subs = [...bench];
      subs[slot.bench] = id;
      setBench(subs);
      if (captainId === id) setCaptainId(null);
      if (viceId === id) setViceId(null);
      setChosenFormation(null);
      return true;
    }
    return false;
  }

  async function save() {
    setSaving(true);
    const { error } = await requireSupabase().rpc('save_squad', {
      p_starters: [...selected],
      p_bench: bench.filter((b): b is number => b !== null),
      p_captain_id: captainId ?? 0,
      p_vice_id: viceId ?? 0,
    });
    setSaving(false);
    if (error) {
      setNotices(errorLines(error).map((text) => ({ kind: 'error', text })));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['squad'] });
    await queryClient.invalidateQueries({ queryKey: ['bank-before'] });
    await queryClient.invalidateQueries({ queryKey: keys.table });
    navigate('/dashboard');
  }

  const visible = pool.filter(
    (p) =>
      (!sideFilter || String(p.side_id) === sideFilter) &&
      (!posFilter || p.position === posFilter) &&
      (!onlyPicked || inSquad(p.id)),
  );

  const allowed = s.formations.length ? s.formations : DEFAULT_FORMATIONS;
  const pickedShape = formationOf(summary.byPosition);
  // Start from the saved squad's shape, or the first allowed formation.
  const formation = chosenFormation ?? (allowed.includes(pickedShape) ? pickedShape : allowed[0]!);
  const rows = pitchRows(picked, formation);
  const extra = overflow(summary.byPosition, formation);
  const bank = summary.bank;
  const slots = Object.fromEntries(
    POSITIONS.map((pos) => [
      pos,
      rows[pos].map((p, i): PitchSlot =>
        p
          ? {
              key: `p${p.id}`,
              position: pos,
              name: shortName(p.name),
              tag: sideById.get(p.side_id)?.short_name,
              sub: nextFor(p),
              subMuted: nextFor(p) === 'No game',
              captain: captainId === p.id,
              badge: viceId === p.id ? 'V' : undefined,
              highlight: swapFrom !== null && canSwap(swapFrom, p.id),
              onClick: () => (swapFrom !== null ? swap(swapFrom, p.id) : setFocus(p.id)),
            }
          : {
              key: `${pos}${i}`,
              position: pos,
              name: null,
              highlight:
                swapFrom !== null &&
                bench.includes(swapFrom) &&
                poolById.get(swapFrom)?.position === pos,
              onClick: () => {
                if (swapFrom === null || !moveTo(swapFrom, { position: pos }))
                  setPicker({ positions: [pos] });
              },
            },
      ),
    ]),
  ) as Record<Position, PitchSlot[]>;
  const outfield: Position[] = ['DEF', 'MID', 'FWD'];
  const benchSlots = bench.map((id, i): PitchSlot => {
    const p = id === null ? null : poolById.get(id);
    const label = i === 0 ? 'Sub GK' : `Sub ${i}`;
    return p
      ? {
          key: `b${p.id}`,
          position: p.position,
          name: shortName(p.name),
          tag: sideById.get(p.side_id)?.short_name,
          sub: nextFor(p),
          subMuted: nextFor(p) === 'No game',
          badge: i === 0 ? undefined : String(i),
          highlight: swapFrom !== null && canSwap(swapFrom, p.id),
          onClick: () => (swapFrom !== null ? swap(swapFrom, p.id) : setFocus(p.id)),
        }
      : {
          key: `b-empty${i}`,
          position: i === 0 ? 'GK' : 'MID',
          name: null,
          label,
          highlight:
            swapFrom !== null && selected.has(swapFrom) && (i === 0) === isKeeper(swapFrom),
          onClick: () => {
            if (swapFrom === null || !moveTo(swapFrom, { bench: i }))
              setPicker({ positions: i === 0 ? ['GK'] : outfield, slot: i });
          },
        };
  });
  const focused = pool.find((p) => p.id === focus);
  const focusedSlot = focused ? benchSlot(focused.id) : -1;
  const swapping = swapFrom !== null ? poolById.get(swapFrom) : undefined;
  const choices = picker
    ? pool
        .filter((p) => picker.positions.includes(p.position) && !inSquad(p.id) && p.active)
        .filter((p) => !sideFilter || String(p.side_id) === sideFilter)
        .sort(
          (a, b) =>
            (points.data?.get(b.id) ?? 0) - (points.data?.get(a.id) ?? 0) || b.price - a.price,
        )
    : [];

  return (
    <>
      <section className="hero !pb-3 !pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="m-0 text-3xl leading-none">{gameweekLabel(gameweek, all)}</h1>
          <span className="text-sm text-white/90">
            Deadline {formatWeekdayTime(gameweek.deadline)}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
          <div className="flex items-baseline justify-center gap-1.5 rounded-lg bg-white/15 px-2 py-1.5">
            <span className={`display-num text-xl ${bank < 0 ? 'text-[#ffd0d0]' : ''}`}>
              {formatPrice(bank)}m
            </span>
            <span className="text-[0.7rem] uppercase text-white/85">Bank</span>
          </div>
          <div className="flex items-baseline justify-center gap-1.5 rounded-lg bg-white/15 px-2 py-1.5">
            <span className="display-num text-xl">
              {summary.transfers === null
                ? 'Free'
                : wildcard
                  ? 'WC'
                  : `${summary.transfers}/${s.transfers_per_gameweek}`}
            </span>
            <span className="text-[0.7rem] uppercase text-white/85">Transfers</span>
          </div>
          <div className="flex items-baseline justify-center gap-1.5 rounded-lg bg-white/15 px-2 py-1.5">
            <span className="display-num text-xl">
              {summary.count}/{STARTERS + BENCH}
            </span>
            <span className="text-[0.7rem] uppercase text-white/85">Squad</span>
          </div>
        </div>
      </section>

      <Notices items={notices} />

      <ChipsCard
        userId={session.user.id}
        gameweek={gameweek}
        gameweeks={all}
        sides={sides.data ?? []}
        onNotice={setNotices}
      />

      <div className="mb-3 flex items-center justify-between gap-2">
        {view === 'pitch' ? (
          <label className="relative">
            <span className="sr-only">Formation</span>
            <select
              className="min-h-tap appearance-none rounded-full bg-[#16181d] py-0 pl-4 pr-9 font-display text-xl font-extrabold tabular-nums text-white"
              value={formation}
              onChange={(e) => setChosenFormation(e.target.value)}
            >
              {allowed.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </label>
        ) : (
          <span />
        )}
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
              {v === 'pitch' ? 'Pitch' : 'List'}
            </button>
          ))}
        </div>
      </div>

      {summary.problems.length > 0 && selected.size > 0 && (
        <details className="mb-3 rounded-xl border border-[#f2c27a] bg-[#fff4e5] px-3 py-2 text-sm font-semibold text-[#6b3d00] dark:border-[#7a5a24] dark:bg-[#2b2113] dark:text-[#f5d9a8]">
          <summary className="cursor-pointer">
            {summary.problems[0]}
            {summary.problems.length > 1 && ` (+${summary.problems.length - 1} more)`}
          </summary>
          {summary.problems.length > 1 && (
            <ul className="mt-1 list-disc pl-5 font-normal">
              {summary.problems.slice(1).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </details>
      )}

      {view === 'pitch' ? (
        <>
          {Object.keys(extra).length > 0 && (
            <p className="mb-3 rounded-xl border border-brand/40 bg-brand/5 px-3 py-2 text-sm font-semibold">
              To play {formation}, remove{' '}
              {Object.entries(extra)
                .map(([pos, n]) => `${n} ${pos}`)
                .join(' and ')}
              . Tap a player to remove or swap them.
            </p>
          )}
          {swapping && (
            <div className="fixed inset-x-4 bottom-[8.5rem] z-30 flex items-center sm:static sm:mb-3 justify-between gap-2 rounded-xl bg-[#16181d] px-3 py-2 text-sm font-semibold text-white shadow-card">
              <span>Tap who {swapping.name} swaps with</span>
              <button
                type="button"
                className="min-h-tap rounded-full px-3 font-display font-bold uppercase text-[#ffd400]"
                onClick={() => setSwapFrom(null)}
              >
                Cancel
              </button>
            </div>
          )}
          <Pitch rows={slots} bench={benchSlots} />
          <details className="muted mt-3 text-center text-sm">
            <summary className="min-h-tap cursor-pointer font-semibold text-brand">
              The strip shows who their side plays. How subs and captains work
            </summary>
            <p className="mt-1 text-left">
              Tap an empty shirt to add a player, or a player to make them captain (C) or vice (V),
              or swap them with a sub. If your captain doesn&apos;t play, your vice scores double
              instead. If a starter doesn&apos;t play, the first sub who did comes on, as long as
              the team still lines up in an allowed formation.
            </p>
          </details>
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
                  <th>C</th>
                  <th>VC</th>
                  <th>Player</th>
                  <th>Pos</th>
                  <th>Side</th>
                  <th className="num">Price</th>
                  <th className="num">Pts</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const isPicked = inSquad(p.id);
                  const slot = benchSlot(p.id);
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
                          disabled={!selected.has(p.id)}
                          checked={captainId === p.id}
                          onChange={() => makeCaptain(p.id)}
                        />
                      </td>
                      <td>
                        <input
                          type="radio"
                          name="vice"
                          className="h-5 w-5 accent-[#16181d]"
                          aria-label={`Vice-captain ${p.name}`}
                          disabled={!selected.has(p.id)}
                          checked={viceId === p.id}
                          onChange={() => makeVice(p.id)}
                        />
                      </td>
                      <td>
                        {p.name}
                        <span className="muted block text-xs">
                          {nextFor(p) === 'No game' ? 'No game' : `v ${nextFor(p)}`} · Form{' '}
                          {formFor(p.id)}
                        </span>
                        {slot >= 0 && (
                          <span className="muted"> ({slot === 0 ? 'sub GK' : `sub ${slot}`})</span>
                        )}
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

      {/* Save stays in reach: sitting on the tab bar on phones (64px tabs + border +
          safe area), pinned at the bottom on desktop. */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+1px+env(safe-area-inset-bottom))] z-20 flex items-center gap-3 border-t border-line bg-surface px-4 py-2 sm:sticky sm:bottom-4 sm:mt-4 sm:rounded-2xl sm:border sm:shadow-card">
        <div className="flex flex-col leading-tight">
          <span className="text-xs uppercase tracking-wide text-ink-soft">
            {summary.problems.length && selected.size
              ? `${summary.problems.length} to fix`
              : 'Ready'}
          </span>
          <span className={`font-bold ${bank < 0 ? 'text-brand' : ''}`}>
            Bank {formatPrice(bank)}m
          </span>
        </div>
        <button type="button" className="btn flex-1" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving' : 'Save squad'}
        </button>
      </div>
      <div className="h-16 sm:hidden" />

      {picker && (
        <Sheet
          title={
            picker.slot === undefined
              ? `Choose a ${POSITION_NAMES[picker.positions[0]!].toLowerCase()}`
              : picker.slot === 0
                ? 'Choose a sub goalkeeper'
                : `Choose sub ${picker.slot}`
          }
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
              <li key={p.id} className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => {
                    add(p.id, picker.slot);
                    setPicker(null);
                  }}
                >
                  <Shirt keeper={p.position === 'GK'} className="h-9 w-9 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.name}</span>
                    <span className="muted block text-xs">
                      {picker.positions.length > 1 && `${p.position} · `}
                      {sideById.get(p.side_id)?.name}
                    </span>
                    <span
                      className={`block text-xs font-semibold ${nextFor(p) === 'No game' ? 'text-ink-soft' : ''}`}
                    >
                      {nextFor(p) === 'No game' ? 'No game' : `v ${nextFor(p)}`} · Form{' '}
                      {formFor(p.id)}
                    </span>
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
                <button
                  type="button"
                  className="min-h-tap shrink-0 rounded-full px-3 font-display text-xs font-bold uppercase text-brand ring-1 ring-line"
                  aria-label={`Stats for ${p.name}`}
                  onClick={() => setStatsFor(p.id)}
                >
                  Stats
                </button>
              </li>
            ))}
            {!choices.length && <li className="muted py-4">No more players in this position.</li>}
          </ul>
        </Sheet>
      )}

      {focused && (
        <Sheet
          title={
            focusedSlot < 0
              ? focused.name
              : `${focused.name} (${focusedSlot === 0 ? 'sub keeper' : `sub ${focusedSlot}`})`
          }
          onClose={() => setFocus(null)}
        >
          <PlayerDetail
            playerId={focused.id}
            gameweekId={lastPlayed?.id}
            actions={
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  {focusedSlot < 0 ? (
                    <>
                      <button
                        type="button"
                        className="btn"
                        disabled={captainId === focused.id}
                        onClick={() => {
                          makeCaptain(focused.id);
                          setFocus(null);
                        }}
                      >
                        {captainId === focused.id ? 'Captain' : 'Make captain'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-quiet"
                        disabled={viceId === focused.id}
                        onClick={() => {
                          makeVice(focused.id);
                          setFocus(null);
                        }}
                      >
                        {viceId === focused.id ? 'Vice-captain' : 'Make vice'}
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className={`btn ${focusedSlot < 0 ? 'btn-quiet' : ''}`}
                    onClick={() => {
                      setSwapFrom(focused.id);
                      setFocus(null);
                      setView('pitch');
                    }}
                  >
                    {focusedSlot < 0 ? 'Swap with sub' : 'Bring on'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => {
                      remove(focused.id);
                      setFocus(null);
                      setPicker(
                        focusedSlot < 0
                          ? { positions: [focused.position] }
                          : { positions: focusedSlot === 0 ? ['GK'] : outfield, slot: focusedSlot },
                      );
                    }}
                  >
                    Transfer out
                  </button>
                </div>
                <button
                  type="button"
                  className="min-h-tap w-full text-sm font-semibold text-brand underline"
                  onClick={() => {
                    remove(focused.id);
                    setFocus(null);
                  }}
                >
                  Remove from squad
                </button>
              </div>
            }
          />
        </Sheet>
      )}

      {statsFor && (
        <PlayerSheet
          playerId={statsFor}
          gameweekId={lastPlayed?.id}
          onClose={() => setStatsFor(null)}
        />
      )}
    </>
  );
}
