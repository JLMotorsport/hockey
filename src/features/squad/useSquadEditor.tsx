import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { type Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { shortName } from '@/lib/format';
import {
  keys,
  nextOpenGameweek,
  useGameweeks,
  usePlayers,
  useSeasonPoints,
  useSettings,
  useSides,
  useAllGameweekPoints,
  useChips,
  useFixtures,
  useSquad,
  lockedGameweeks,
  useOwnership,
  usePriceTrend,
} from '@/lib/queries';
import {
  cardNames,
  fixtureCode,
  PLAYER_DATA,
  priceChange,
  type PlayerData,
} from '@/lib/pickDisplay';
import { fixtureLabel, formByPlayer } from '@/lib/form';
import { useTransitionClick, useTransitionNavigate } from '@/lib/navTransition';
import { usePlayerColumns } from '@/features/player/statColumns';
import { POSITIONS, type Position } from '@/lib/scoring';
import { DEFAULT_FORMATIONS, formationOf, pitchRows } from '@/lib/formation';
import { type PitchSlot } from '@/components/Pitch';
import {
  autoArrange,
  autoPick,
  BENCH,
  formatPrice,
  isValidArrangement,
  SQUAD_QUOTA,
  fitsQuota,
  STARTERS,
  summariseSquad,
  type SquadPlayer,
} from '@/lib/squad';
import { errorLines, requireSupabase } from '@/lib/supabase';

/**
 * The squad being edited for the next gameweek, shared by every design
 * version: who's picked, the bench, armbands, transfers, bank, the rules
 * (mirrored from save_squad) and saving. Pick team and Transfers are two
 * pages over the same squad, as in FPL.
 */
export function useSquadEditor(mode: 'pick' | 'transfers') {
  const { session } = useAuth();
  const go = useTransitionNavigate();
  const transitionClick = useTransitionClick();
  const queryClient = useQueryClient();
  const gameweeks = useGameweeks();
  const players = usePlayers();
  const sides = useSides();
  const settings = useSettings();
  const points = useSeasonPoints();
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
  // What the line under each card shows (FPL's "Player Data"), remembered per device.
  const lastLocked = lockedGameweeks(all).at(-1);
  const trend = usePriceTrend();
  const ownership = useOwnership(lastLocked?.id);
  const [dataKey, setDataKey] = useState<PlayerData>(() => {
    try {
      const saved = localStorage.getItem('pick-player-data');
      return PLAYER_DATA.find((o) => o.key === saved)?.key ?? 'opponent';
    } catch {
      return 'opponent';
    }
  });
  const [dataOpen, setDataOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  function chooseData(key: PlayerData) {
    setDataKey(key);
    setDataOpen(false);
    try {
      localStorage.setItem('pick-player-data', key);
    } catch {
      // Private browsing: it just isn't remembered.
    }
  }
  const wildcard = Boolean(
    gameweek && chips.data?.some((c) => c.chip === 'wildcard' && c.gameweek_id === gameweek.id),
  );

  // Start from the saved squad straight away when it's already loaded (it
  // usually is, from Home or the other squad page), so the pitch never
  // flashes empty on the way in.
  const saved = gameweek && current.data ? fromSaved(current.data) : null;
  const [selected, setSelected] = useState<Set<number>>(() => saved?.selected ?? new Set());
  const [captainId, setCaptainId] = useState<number | null>(() => saved?.captain ?? null);
  const [viceId, setViceId] = useState<number | null>(() => saved?.vice ?? null);
  const [loadedFrom, setLoadedFrom] = useState<number | null>(() =>
    saved && gameweek ? gameweek.id : null,
  );
  const [notices, setNotices] = useState<Notice[]>([]);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'pitch' | 'list'>('pitch');
  const { columns: statColumns, points: statPoints } = usePlayerColumns();
  const [problemsOpen, setProblemsOpen] = useState(false);
  // Choosing a player: for a pitch position, or for a bench slot (0 = sub keeper).
  const [picker, setPicker] = useState<{ positions: Position[]; slot?: number } | null>(null);
  // Subs bench: [sub keeper, sub 1, sub 2, sub 3].
  const [bench, setBench] = useState<(number | null)[]>(
    () => saved?.bench ?? [null, null, null, null],
  );
  // A player tapped for "swap with": the next player tapped trades places.
  const [swapFrom, setSwapFrom] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [statsFor, setStatsFor] = useState<number | null>(null);

  // Otherwise from the saved squad once it arrives (or after a reset).
  useEffect(() => {
    if (!gameweek || !current.data || loadedFrom === gameweek.id) return;
    const s = fromSaved(current.data);
    setSelected(s.selected);
    setBench(s.bench);
    setCaptainId(s.captain);
    setViceId(s.vice);
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

  if (!session) return { status: 'login' as const };
  if (gameweeks.isLoading || players.isLoading || sides.isLoading || settings.isLoading)
    return { status: 'loading' as const };
  if (players.error) return { status: 'error' as const, error: players.error };
  if (!gameweek) return { status: 'nogw' as const };
  const s = settings.data!;
  const allowed = s.formations.length ? s.formations : DEFAULT_FORMATIONS;
  const picked = pool.filter((p) => selected.has(p.id));
  const poolById = new Map(pool.map((p) => [p.id, p]));
  const benchPlayers = bench.map((id) => (id === null ? null : (poolById.get(id) ?? null)));
  const priceById = new Map((players.data ?? []).map((p) => [p.id, p.price]));
  const positionById = new Map((players.data ?? []).map((p) => [p.id, p.position]));
  // Last gameweek's squad doesn't make 2/5/5/3 (saved before the rule, or a
  // position has changed since): putting it right uses no transfers.
  const previousCounts: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const id of previousIds) {
    const pos = positionById.get(id);
    if (pos) previousCounts[pos] += 1;
  }
  const freeFix = previousIds.length > 0 && !fitsQuota(previousCounts);
  const summary = summariseSquad(
    picked,
    benchPlayers,
    captainId,
    viceId,
    // A wildcard or a squad that needs reshaping lifts the transfer limit (as in save_squad).
    wildcard || freeFix ? { ...s, transfers_per_gameweek: Infinity } : s,
    currentIds,
    previousIds,
    { base: bankBefore.data ?? s.budget, priceOf: (id) => priceById.get(id) ?? 0 },
    currentStarters,
  );
  // Transfers is about who's in the 15: the line-up (formation, armbands,
  // subs order) is sorted out on save and on Pick team, so not listed here.
  const lineUp =
    /^(That's a |Start exactly|The first sub|Subs 1 to 3|Choose a (captain|vice)|Pick \d+ (starters|subs))/;
  const problems =
    mode === 'transfers'
      ? [
          ...(summary.count < STARTERS + BENCH
            ? [`Pick ${STARTERS + BENCH} players (you have ${summary.count}).`]
            : []),
          ...summary.problems.filter((p) => !lineUp.test(p)),
        ]
      : summary.problems;
  const inSquad = (id: number) => selected.has(id) || bench.includes(id);
  const isKeeper = (id: number) => poolById.get(id)?.position === 'GK';
  // Who the player's side plays in the gameweek being picked.
  const nextFor = (p: SquadPlayer) => fixtureLabel(fixtures.data ?? [], p.side_id, gameweek.id);
  const benchSlot = (id: number) => bench.indexOf(id);

  /** Add to the starting 11 if there's room, else the first fitting bench slot. */
  function add(id: number, slot?: number) {
    if (slot !== undefined) {
      const next = [...bench];
      next[slot] = id;
      setBench(next);
      return;
    }
    const keeperStarts = [...selected].some((x) => isKeeper(x));
    if (selected.size < STARTERS && !(isKeeper(id) && keeperStarts)) {
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

  /**
   * Who can replace a player: like for like, unless the squad doesn't make
   * 2/5/5/3, when any outfield position still short once they've gone.
   */
  function replacementPositions(p: SquadPlayer): Position[] {
    const counts: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const id of [...selected, ...bench]) {
      const q = id === null ? undefined : poolById.get(id);
      if (q) counts[q.position] += 1;
    }
    if (fitsQuota(counts) || p.position === 'GK') return [p.position];
    counts[p.position] -= 1;
    const short = (['DEF', 'MID', 'FWD'] as Position[]).filter(
      (pos) => counts[pos] < SQUAD_QUOTA[pos],
    );
    return short.length ? short : [p.position];
  }

  /** To Transfers, checking first if there are unsaved changes here. */
  function goTransfers() {
    if (!dirty || window.confirm('You have unsaved changes. Leave without saving?'))
      go('/transfers', 'swap');
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
      return true;
    }
    return false;
  }

  async function save() {
    let starters = [...selected];
    let subs = bench.filter((b): b is number => b !== null);
    let captain = captainId;
    let vice = viceId;
    if (mode === 'transfers') {
      // New players went wherever there was room; if that isn't a team that
      // can line up, lay the 15 out again (Pick team can change it after).
      const squad = [...starters, ...subs].map((id) => poolById.get(id)!).filter(Boolean);
      const valid = isValidArrangement(
        starters.map((id) => poolById.get(id)!),
        bench.map((id) => (id === null ? null : (poolById.get(id) ?? null))),
        allowed,
      );
      if (!valid) {
        const arranged = autoArrange(squad, allowed, [...starters, ...subs]);
        if (arranged) {
          starters = arranged.starters;
          subs = arranged.bench;
        }
      }
      // Armbands go to the best starters when theirs have gone.
      const ranked = starters
        .filter((id) => !isKeeper(id))
        .sort((a, b) => (points.data?.get(b) ?? 0) - (points.data?.get(a) ?? 0));
      if (captain === null || !starters.includes(captain))
        captain = ranked.find((id) => id !== vice) ?? null;
      if (vice === null || !starters.includes(vice) || vice === captain)
        vice = ranked.find((id) => id !== captain) ?? null;
    }
    setSaving(true);
    const { error } = await requireSupabase().rpc('save_squad', {
      p_starters: starters,
      p_bench: subs,
      p_captain_id: captain ?? 0,
      p_vice_id: vice ?? 0,
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
    // After transfers, on to picking the team, as in FPL.
    if (mode === 'transfers') {
      setLoadedFrom(null);
      go('/squad', 'swap');
    } else go('/dashboard', 'back');
  }

  const squadPlayers = [...picked, ...benchPlayers.filter((p): p is SquadPlayer => p !== null)];
  const names = cardNames(squadPlayers);
  const lastPoints = new Map(
    (gameweekPoints.data ?? [])
      .filter((r) => r.gameweek_id === lastLocked?.id)
      .map((r) => [r.player_id, r.points]),
  );
  /** The line under a card, for the chosen Player Data. */
  function dataFor(p: SquadPlayer): string {
    switch (dataKey) {
      case 'opponent':
        return fixtureCode(fixtures.data ?? [], p.side_id, gameweek!.id);
      case 'price':
        return `${formatPrice(p.price)}m`;
      case 'change':
        return priceChange(trend.data?.get(p.id));
      case 'form':
        return form.get(p.id)?.toFixed(1) ?? '-';
      case 'gw':
        return lastLocked ? `${lastPoints.get(p.id) ?? 0} pts` : '-';
      case 'total':
        return `${points.data?.get(p.id) ?? 0} pts`;
      case 'ownership':
        return lastLocked ? `${ownership.data?.get(p.id) ?? 0}%` : '-';
    }
  }
  const dataMuted = (p: SquadPlayer) => dataKey === 'opponent' && dataFor(p) === 'No game';
  const pickedShape = formationOf(summary.byPosition);
  // The shape the starters make; with fewer than 11, room for the first allowed one.
  const formation =
    selected.size === STARTERS || allowed.includes(pickedShape) ? pickedShape : allowed[0]!;
  const rows = pitchRows(picked, formation);
  const bank = summary.bank;
  const slots = Object.fromEntries(
    POSITIONS.map((pos) => [
      pos,
      rows[pos].map((p, i): PitchSlot =>
        p
          ? {
              key: `p${p.id}`,
              position: pos,
              name: names.get(p.id) ?? shortName(p.name),
              sub: dataFor(p),
              subMuted: dataMuted(p),
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
                if (swapFrom === null || !moveTo(swapFrom, { position: pos })) goTransfers();
              },
            },
      ),
    ]),
  ) as Record<Position, PitchSlot[]>;
  const benchSlots = bench.map((id, i): PitchSlot => {
    const p = id === null ? null : poolById.get(id);
    const label = i === 0 ? 'Sub GK' : `Sub ${i}`;
    return p
      ? {
          key: `b${p.id}`,
          position: p.position,
          name: names.get(p.id) ?? shortName(p.name),
          sub: dataFor(p),
          subMuted: dataMuted(p),
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
            if (swapFrom === null || !moveTo(swapFrom, { bench: i })) goTransfers();
          },
        };
  });
  const focused = pool.find((p) => p.id === focus);
  const focusedSlot = focused ? benchSlot(focused.id) : -1;
  const swapping = swapFrom !== null ? poolById.get(swapFrom) : undefined;
  const choices = picker
    ? pool
        .filter((p) => picker.positions.includes(p.position) && !inSquad(p.id) && p.active)
        .sort(
          (a, b) =>
            (points.data?.get(b.id) ?? 0) - (points.data?.get(a.id) ?? 0) || b.price - a.price,
        )
    : [];

  // Transfers: the 15 by position, price above each, empty slots up to FPL's
  // 2 GK, 5 DEF, 5 MID, 3 FWD while the squad isn't full.
  const sideCounts = new Map<number, number>();
  for (const p of squadPlayers) sideCounts.set(p.side_id, (sideCounts.get(p.side_id) ?? 0) + 1);

  /** Auto Pick: fill the empty places within the bank, then line them up. */
  function autoFill() {
    const added = autoPick({
      squad: squadPlayers,
      pool: pool.filter((p) => p.active && !inSquad(p.id)),
      bank,
      maxPerSide: s.max_per_side,
      score: (id) => (points.data?.get(id) ?? 0) + 3 * (form.get(id) ?? 0),
    });
    if (!added) {
      setNotices([
        {
          kind: 'error',
          text: "There isn't enough in the bank to fill every place. Sell someone pricier first.",
        },
      ]);
      return;
    }
    const full = [...squadPlayers, ...added];
    const order = [
      ...selected,
      ...bench.filter((b): b is number => b !== null),
      ...added.map((p) => p.id),
    ];
    const arranged = autoArrange(full, allowed, order);
    if (arranged) {
      setSelected(new Set(arranged.starters));
      setBench(arranged.bench);
    } else {
      for (const p of added) add(p.id);
    }
    setNotices([
      {
        kind: 'success',
        text: `Added ${added.length} player${added.length === 1 ? '' : 's'}. Swap any you don't fancy, then Save.`,
      },
    ]);
  }

  let room = STARTERS + BENCH - squadPlayers.length;
  const transferRows = Object.fromEntries(
    POSITIONS.map((pos) => {
      const here = squadPlayers.filter((p) => p.position === pos);
      const empty = Math.max(0, Math.min(room, SQUAD_QUOTA[pos] - here.length));
      room -= empty;
      return [
        pos,
        [
          ...here.map((p): PitchSlot => ({
            key: `t${p.id}`,
            position: pos,
            name: names.get(p.id) ?? shortName(p.name),
            heading: `${formatPrice(p.price)}m`,
            headingPill: true,
            sub: dataFor(p),
            subMuted: dataMuted(p),
            // New this gameweek, as FPL outlines a player just brought in.
            highlight: previousIds.length > 0 && !previousIds.includes(p.id),
            onClick: () => setFocus(p.id),
          })),
          ...Array.from({ length: empty }, (_, i): PitchSlot => ({
            key: `t-${pos}${i}`,
            position: pos,
            name: null,
            onClick: () => setPicker({ positions: [pos] }),
          })),
        ],
      ];
    }),
  ) as Record<Position, PitchSlot[]>;

  // This gameweek's transfers for the confirm sheet: out and in, like for like.
  const ins = squadPlayers.filter((p) => !previousIds.includes(p.id));
  const outs = previousIds.length
    ? previousIds
        .filter((id) => !inSquad(id))
        .map((id) => (players.data ?? []).find((q) => q.id === id))
        .filter((q): q is NonNullable<typeof q> => Boolean(q))
    : [];
  const moves: [MovePlayer | null, MovePlayer | null][] = [];
  const unpaired = previousIds.length ? [...ins] : [];
  for (const out of outs) {
    const i = unpaired.findIndex((q) => q.position === out.position);
    moves.push([out, i >= 0 ? unpaired.splice(i, 1)[0]! : null]);
  }
  for (const inn of unpaired) moves.push([null, inn]);

  // Unsaved changes, so switching page can warn first.
  const savedStarters = new Set(currentStarters);
  const savedBench = [null, null, null, null] as (number | null)[];
  for (const r of current.data ?? [])
    if (r.bench_order) savedBench[r.bench_order - 1] = r.player_id;
  const dirty =
    selected.size !== savedStarters.size ||
    [...selected].some((id) => !savedStarters.has(id)) ||
    bench.some((id, i) => id !== savedBench[i]) ||
    captainId !== (current.data?.find((r) => r.is_captain)?.player_id ?? null) ||
    viceId !== (current.data?.find((r) => r.is_vice)?.player_id ?? null);
  const leave = (to: string) => (e: { preventDefault: () => void }) => {
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?'))
      e.preventDefault();
    else setLoadedFrom(null);
    void to;
  };
  const empty = squadPlayers.length === 0;
  const showProblems = problems.length > 0 && (selected.size > 0 || bench.some((b) => b !== null));
  return {
    status: 'ready' as const,
    session,
    go,
    transitionClick,
    queryClient,
    gameweeks,
    players,
    sides,
    settings,
    points,
    bankBefore,
    all,
    gameweek,
    lastPlayed,
    previousGw,
    userId,
    current,
    previous,
    chips,
    fixtures,
    gameweekPoints,
    form,
    lastLocked,
    trend,
    ownership,
    dataKey,
    setDataKey,
    dataOpen,
    setDataOpen,
    confirmOpen,
    setConfirmOpen,
    chooseData,
    wildcard,
    saved,
    selected,
    setSelected,
    captainId,
    setCaptainId,
    viceId,
    setViceId,
    loadedFrom,
    setLoadedFrom,
    notices,
    setNotices,
    saving,
    setSaving,
    view,
    setView,
    statColumns,
    statPoints,
    problemsOpen,
    setProblemsOpen,
    picker,
    setPicker,
    bench,
    setBench,
    swapFrom,
    setSwapFrom,
    focus,
    setFocus,
    statsFor,
    setStatsFor,
    sideById,
    currentIds,
    currentStarters,
    previousIds,
    pool,
    s,
    allowed,
    picked,
    poolById,
    benchPlayers,
    priceById,
    positionById,
    previousCounts,
    freeFix,
    summary,
    lineUp,
    problems,
    inSquad,
    isKeeper,
    nextFor,
    benchSlot,
    add,
    replacementPositions,
    goTransfers,
    remove,
    makeCaptain,
    makeVice,
    canSwap,
    swap,
    moveTo,
    save,
    squadPlayers,
    names,
    lastPoints,
    dataFor,
    dataMuted,
    pickedShape,
    formation,
    rows,
    bank,
    slots,
    benchSlots,
    focused,
    focusedSlot,
    swapping,
    choices,
    sideCounts,
    autoFill,
    room,
    transferRows,
    ins,
    outs,
    moves,
    unpaired,
    savedStarters,
    savedBench,
    dirty,
    leave,
    empty,
    showProblems,
  };
}

export type SquadEditor = Extract<ReturnType<typeof useSquadEditor>, { status: 'ready' }>;

/** A saved squad as the page's state: starters, bench order and armbands. */
function fromSaved(
  rows: { player_id: number; bench_order: number | null; is_captain: boolean; is_vice: boolean }[],
) {
  const bench: (number | null)[] = [null, null, null, null];
  for (const r of rows) if (r.bench_order) bench[r.bench_order - 1] = r.player_id;
  return {
    selected: new Set(rows.filter((r) => r.bench_order === null).map((r) => r.player_id)),
    bench,
    captain: rows.find((r) => r.is_captain)?.player_id ?? null,
    vice: rows.find((r) => r.is_vice)?.player_id ?? null,
  };
}

export type MovePlayer = { name: string; position: Position; side_id: number; price: number };
