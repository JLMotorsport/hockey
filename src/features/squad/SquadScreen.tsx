import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ErrorText, Loading, Notices, PosBadge, type Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { formatDeadline, formatWeekdayTime, gameweekLabel, shortName } from '@/lib/format';
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
import { ChipsCard } from './ChipsCard';
import { chipName } from '@/lib/chips';
import { PlayerPicker } from './PlayerPicker';
import { StatsTable } from '@/components/StatsTable';
import { usePlayerColumns } from '@/features/player/statColumns';
import { POSITION_NAMES, POSITIONS, type Position } from '@/lib/scoring';
import { DEFAULT_FORMATIONS, formationOf, pitchRows } from '@/lib/formation';
import { Pitch, type PitchSlot } from '@/components/Pitch';
import { Sheet } from '@/components/Sheet';
import { PlayerDetail, PlayerSheet } from '@/features/player/PlayerDetail';
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
 * Two pages over the same squad, as in FPL. Pick team: the starting 11, subs,
 * captain and vice, and the team chips. Transfers: who is in the 15, the
 * bank and the wildcard.
 */
export function SquadScreen({ mode = 'pick' }: { mode?: 'pick' | 'transfers' }) {
  const { session } = useAuth();
  const navigate = useNavigate();
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
  const [chipsOpen, setChipsOpen] = useState(false);
  const { columns: statColumns, points: statPoints } = usePlayerColumns();
  const [problemsOpen, setProblemsOpen] = useState(false);
  // Choosing a player: for a pitch position, or for a bench slot (0 = sub keeper).
  const [picker, setPicker] = useState<{ positions: Position[]; slot?: number } | null>(null);
  // Subs bench: [sub keeper, sub 1, sub 2, sub 3].
  const [bench, setBench] = useState<(number | null)[]>([null, null, null, null]);
  // A player tapped for "swap with": the next player tapped trades places.
  const [swapFrom, setSwapFrom] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [statsFor, setStatsFor] = useState<number | null>(null);

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
      navigate('/transfers');
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
      navigate('/squad');
    } else navigate('/dashboard');
  }

  const visible = pool.filter(
    (p) =>
      (!sideFilter || String(p.side_id) === sideFilter) &&
      (!posFilter || p.position === posFilter) &&
      (!onlyPicked || inSquad(p.id)),
  );

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
            name: shortName(p.name),
            tag: sideById.get(p.side_id)?.short_name,
            heading: `${formatPrice(p.price)}m`,
            headingPill: true,
            sub: nextFor(p),
            subMuted: nextFor(p) === 'No game',
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
  // Chips for this page: team chips on Pick team, the wildcard on Transfers.
  const pageChips = mode === 'pick' ? ['triple_captain', 'rolling_subs', 'team_bus'] : ['wildcard'];
  const played = chips.data?.find(
    (c) => c.gameweek_id === gameweek.id && pageChips.includes(c.chip),
  );
  const activeChip = played ? chipName(played.chip) : null;
  const showProblems = problems.length > 0 && (selected.size > 0 || bench.some((b) => b !== null));
  const surname = (id: number | null) =>
    id
      ? (shortName(poolById.get(id)?.name ?? '')
          .split(' ')
          .at(-1) ?? '-')
      : '-';
  // The numbers that matter while picking, always in view in the bottom bar.
  const barStats: [string, string, boolean][] =
    mode === 'pick'
      ? [
          ['Shape', selected.size === STARTERS ? pickedShape : '-', false],
          ['Captain', surname(captainId), false],
          ['Vice', surname(viceId), false],
        ]
      : [
          ['Bank', `${formatPrice(bank)}m`, bank < 0],
          [
            'Transfers',
            summary.transfers === null || freeFix
              ? 'Free'
              : wildcard
                ? 'WC'
                : `${summary.transfers}/${s.transfers_per_gameweek}`,
            false,
          ],
          ['Squad', `${summary.count}/${STARTERS + BENCH}`, summary.count !== STARTERS + BENCH],
        ];

  const overlays = (
    <>
      {picker && (
        <PlayerPicker
          title={
            picker.positions.length > 1
              ? 'Choose a replacement'
              : picker.slot === undefined
                ? `Add a ${POSITION_NAMES[picker.positions[0]!].toLowerCase()}`
                : picker.slot === 0
                  ? 'Add a sub goalkeeper'
                  : `Add sub ${picker.slot}`
          }
          candidates={choices}
          bank={bank}
          sides={sides.data ?? []}
          sideCounts={sideCounts}
          maxPerSide={s.max_per_side}
          showPosition={picker.positions.length > 1}
          nextFor={nextFor}
          onPick={(id) => {
            add(id, picker.slot);
            setPicker(null);
          }}
          onStats={setStatsFor}
          onClose={() => setPicker(null)}
        />
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
              mode === 'transfers' ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    className="btn w-full"
                    onClick={() => {
                      remove(focused.id);
                      setFocus(null);
                      setPicker(
                        focusedSlot < 0
                          ? { positions: replacementPositions(focused) }
                          : {
                              positions: focusedSlot === 0 ? ['GK'] : replacementPositions(focused),
                              slot: focusedSlot,
                            },
                      );
                    }}
                  >
                    Transfer out
                  </button>
                  <button
                    type="button"
                    className="min-h-tap w-full text-sm font-semibold text-brand underline"
                    onClick={() => {
                      remove(focused.id);
                      setFocus(null);
                    }}
                  >
                    Remove (leave the slot empty)
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {focusedSlot < 0 && (
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
                  )}
                  <button
                    type="button"
                    className={`btn ${focusedSlot < 0 ? 'btn-quiet' : ''}`}
                    onClick={() => {
                      setSwapFrom(focused.id);
                      setFocus(null);
                    }}
                  >
                    {focusedSlot < 0 ? 'Swap with sub' : 'Bring on'}
                  </button>
                  <Link
                    to="/transfers"
                    onClick={leave('/transfers')}
                    className="btn btn-quiet no-underline hover:no-underline"
                  >
                    Transfer
                  </Link>
                </div>
              )
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

  if (mode === 'pick') {
    const subsTone = 'text-[#1f7a4d] dark:text-[#7fd6a2]';
    const groups = [
      ...POSITIONS.map((pos) => ({
        title: pos === 'GK' ? 'Goalkeeper' : `${POSITION_NAMES[pos]}s`,
        rows: picked.filter((p) => p.position === pos),
      })),
      {
        title: 'Subs',
        rows: benchPlayers.filter((p): p is SquadPlayer => p !== null),
        tone: subsTone,
      },
    ];
    const chrome = 'bg-black/[0.06] dark:bg-[#1f232c]';
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-[26rem] flex-col px-2 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
        {/* Title bar, as FPL's: back, the page, and Transfers where FPL has its assistant. */}
        <header className="flex h-[46px] shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Back"
            onClick={() => {
              if (dirty && !window.confirm('You have unsaved changes. Leave without saving?'))
                return;
              // Always back to My Team, as FPL, wherever you came from.
              setLoadedFrom(null);
              navigate('/dashboard');
            }}
            className="flex h-11 w-11 items-center justify-center"
          >
            <span
              aria-hidden="true"
              className={`flex h-9 w-9 items-center justify-center rounded-full pb-0.5 text-xl ${chrome}`}
            >
              ‹
            </span>
          </button>
          <h1 className="m-0 flex-1 text-center font-sans text-[1.2rem] font-extrabold normal-case tracking-normal">
            Pick Team
          </h1>
          <Link
            to="/transfers"
            onClick={leave('/transfers')}
            className="flex min-h-tap items-center text-ink no-underline hover:no-underline"
          >
            <span
              className={`flex h-8 items-center rounded-full px-2.5 text-xs font-bold ${chrome}`}
            >
              Transfers
            </span>
          </Link>
        </header>
        <p className="m-0 shrink-0 pb-2 pt-0.5 text-center text-[0.8rem]">
          <span className="font-semibold text-ink-soft">
            Gameweek {all.filter((g) => g.start_date <= gameweek.start_date).length}
          </span>{' '}
          <span className="text-ink-soft">•</span>{' '}
          <b>Deadline: {formatDeadline(gameweek.deadline)}</b>
        </p>

        <Notices items={notices} />

        {empty ? (
          <section className="card mt-2 text-center">
            <h2>No squad yet</h2>
            <p className="muted mb-3">Pick your 15 players on Transfers first.</p>
            <Link className="btn" to="/transfers">
              Go to transfers
            </Link>
          </section>
        ) : (
          <>
            <ChipsCard
              userId={session.user.id}
              gameweek={gameweek}
              gameweeks={all}
              sides={sides.data ?? []}
              onNotice={setNotices}
              elsewhere={{ wildcard: 'Transfers' }}
            />
            <div className="mb-2 flex shrink-0 items-center gap-2">
              <div
                className={`flex flex-1 rounded-[10px] p-[3px] ${chrome}`}
                role="group"
                aria-label="View"
              >
                {(['pitch', 'list'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={`min-h-[38px] flex-1 rounded-lg text-sm font-semibold capitalize ${view === v ? 'bg-[#14181f] text-white dark:bg-[#eceff4] dark:text-[#0e1014]' : 'text-ink-soft'}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              {view === 'pitch' && (
                <button
                  type="button"
                  onClick={() => setDataOpen(true)}
                  aria-label={`Player data: ${PLAYER_DATA.find((o) => o.key === dataKey)?.label}. Change`}
                  className="flex min-h-tap items-center gap-1.5 rounded-[10px] border border-line px-2.5 text-sm font-semibold"
                >
                  <span
                    aria-hidden="true"
                    className="h-3 w-4 rounded-[2px] border-[1.5px] border-current"
                  />
                  {PLAYER_DATA.find((o) => o.key === dataKey)?.label}
                  <span aria-hidden="true" className="text-[0.6rem]">
                    ▼
                  </span>
                </button>
              )}
            </div>

            {view === 'pitch' ? (
              <Pitch
                rows={slots}
                bench={benchSlots}
                compact
                variant="card"
                fieldClass={dirty ? PICK_FIELD.saving : PICK_FIELD.idle}
              />
            ) : (
              <StatsTable
                rows={squadPlayers}
                groups={groups}
                columns={statColumns}
                defaultSort="pts"
                tiebreak={(p) => statPoints(p.id)}
                lead={(p) => {
                  const slot = benchSlot(p.id);
                  const badge = captainId === p.id ? 'C' : viceId === p.id ? 'V' : null;
                  const side = sideById.get(p.side_id)?.short_name ?? '';
                  return (
                    <span className="flex min-w-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`${p.name}: stats`}
                        onClick={() => setStatsFor(p.id)}
                        className="-ml-2 flex h-11 w-7 shrink-0 items-center justify-center font-serif font-bold italic text-ink-soft"
                      >
                        i
                      </button>
                      <button
                        type="button"
                        onClick={() => setFocus(p.id)}
                        className="flex min-h-tap min-w-0 flex-1 flex-col justify-center text-left"
                      >
                        <span className="truncate font-bold">{p.name}</span>
                        <span className="muted truncate text-xs">
                          {slot >= 0
                            ? `${slot === 0 ? 'Sub GK' : `Sub ${slot}`} · ${side}`
                            : `${side} · ${nextFor(p)}`}
                        </span>
                      </button>
                      {badge && (
                        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-ink text-[0.62rem] font-extrabold text-surface">
                          {badge}
                        </span>
                      )}
                    </span>
                  );
                }}
              />
            )}
          </>
        )}

        {swapping && (
          <div className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-[25rem] items-center justify-between gap-2 rounded-xl bg-[#16181d] px-3 py-2 text-sm font-semibold text-white shadow-card">
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

        {/* Only once something has changed, as in FPL. */}
        {dirty && !empty && (
          <div className="sticky bottom-0 z-20 -mx-2 mt-auto bg-paper px-2.5 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-2">
            {showProblems && problemsOpen && (
              <ul className="mb-2 list-disc space-y-1 rounded-xl border border-[#f2c27a] bg-[#fff4e5] py-2 pl-7 pr-3 text-sm font-semibold text-[#6b3d00] dark:border-[#7a5a24] dark:bg-[#2b2113] dark:text-[#f5d9a8]">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {/* A broken rule sits beside Save, so the pitch doesn't move. */}
            <div className="flex gap-2">
              {showProblems && (
                <button
                  type="button"
                  onClick={() => setProblemsOpen(!problemsOpen)}
                  aria-expanded={problemsOpen}
                  className="flex min-h-[46px] min-w-0 flex-1 items-center gap-1.5 text-left text-[0.8rem] font-semibold leading-tight text-[#8a4b00] dark:text-[#ffc773]"
                >
                  <span aria-hidden="true">⚠</span>
                  <span className="line-clamp-2 min-w-0">
                    {problems[0]}
                    {problems.length > 1 && ` (+${problems.length - 1} more)`}
                  </span>
                </button>
              )}
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className={`min-h-[46px] rounded-full bg-[#e83434] text-base font-extrabold text-white disabled:opacity-60 ${showProblems ? 'shrink-0 px-5' : 'w-full'}`}
              >
                {saving ? 'Saving' : showProblems ? 'Save' : 'Save Your Team'}
              </button>
            </div>
          </div>
        )}

        {dataOpen && (
          <Sheet title="Player Data" onClose={() => setDataOpen(false)}>
            <div role="radiogroup" aria-label="Player data">
              {PLAYER_DATA.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={dataKey === o.key}
                  onClick={() => chooseData(o.key)}
                  className="flex min-h-[52px] w-full items-center border-b border-line text-left"
                >
                  <span className="flex flex-1 flex-col">
                    <span className="text-[1.05rem] font-bold">{o.label}</span>
                    <span className="text-xs text-ink-soft">{o.help}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-ink"
                  >
                    {dataKey === o.key && (
                      <span className="h-[11px] w-[11px] rounded-full bg-ink" />
                    )}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3.5 text-xs leading-snug text-ink-soft">
              FPL&apos;s FDR and Selling Price aren&apos;t here: we don&apos;t have opponents&apos;
              league tables, and players sell at their current price.
            </p>
          </Sheet>
        )}

        {overlays}
      </div>
    );
  }

  return (
    <>
      {/* Red bar: the gameweek, the page switch and chips, all in one. */}
      <section className="hero !mb-2 !pb-2 !pt-2">
        <div className="flex items-baseline gap-2">
          <h1 className="m-0 text-xl leading-none">{gameweekLabel(gameweek, all).split(' ')[0]}</h1>
          <span className="text-xs text-white/90">
            Deadline {formatWeekdayTime(gameweek.deadline)}
          </span>
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <nav className="flex flex-1 rounded-full bg-black/20 p-1" aria-label="Squad pages">
            {(
              [
                ['/squad', 'Pick team', 'pick'],
                ['/transfers', 'Transfers', 'transfers'],
              ] as const
            ).map(([to, label, m]) => (
              <Link
                key={to}
                to={to}
                onClick={mode === m ? undefined : leave(to)}
                aria-current={mode === m ? 'page' : undefined}
                className={`flex min-h-[36px] flex-1 items-center justify-center rounded-full font-display text-sm font-bold uppercase no-underline hover:no-underline ${mode === m ? 'bg-white text-brand' : 'text-white/85 hover:text-white'}`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => setChipsOpen(true)}
            className={`flex min-h-tap max-w-[9rem] items-center gap-1 rounded-full px-3 font-display text-sm font-bold uppercase ${activeChip ? 'bg-white text-brand' : 'bg-black/20 text-white'}`}
          >
            <span className="truncate">{activeChip ? `${activeChip} ✓` : 'Chips'}</span>
            <span className="text-[0.6rem]" aria-hidden="true">
              ▼
            </span>
          </button>
          {mode === 'transfers' && (
            <button
              type="button"
              onClick={() => setView(view === 'pitch' ? 'list' : 'pitch')}
              aria-label={view === 'pitch' ? 'Show as a list' : 'Show on the pitch'}
              className="min-h-tap rounded-full bg-black/20 px-3 font-display text-sm font-bold uppercase text-white"
            >
              {view === 'pitch' ? 'List' : 'Pitch'}
            </button>
          )}
        </div>
      </section>

      <Notices items={notices} />

      {chipsOpen && (
        <Sheet title="Chips" onClose={() => setChipsOpen(false)}>
          <ChipsCard
            userId={session.user.id}
            gameweek={gameweek}
            gameweeks={all}
            sides={sides.data ?? []}
            onNotice={setNotices}
            only={['wildcard']}
          />
        </Sheet>
      )}

      {view === 'pitch' ? (
        <>
          {freeFix && (
            <p className="mb-3 rounded-xl border border-[#9cc3ea] bg-[#eaf3fc] px-3 py-2 text-sm font-semibold text-[#123a5e] dark:border-[#2c4f73] dark:bg-[#14263a] dark:text-[#cfe3f7]">
              Squads are now 2 GK, 5 DEF, 5 MID and 3 FWD. Changes this week to get yours there are
              free: tap a player to swap them for a position you&apos;re short of.
            </p>
          )}
          <div className="relative">
            <Pitch rows={transferRows} compact />
            {squadPlayers.length < STARTERS + BENCH && (
              <button
                type="button"
                onClick={autoFill}
                className="absolute left-3 top-6 z-10 min-h-[36px] rounded-full bg-white px-3 font-display text-sm font-extrabold uppercase text-[#14181f] shadow-card"
              >
                Auto pick
              </button>
            )}
            {dirty && (
              <button
                type="button"
                onClick={() => {
                  setSwapFrom(null);
                  setLoadedFrom(null);
                  setNotices([]);
                }}
                className="absolute right-3 top-6 z-10 min-h-[36px] rounded-full bg-black/55 px-3 font-display text-sm font-extrabold uppercase text-white shadow-card"
              >
                Reset
              </button>
            )}
          </div>
          <p className="muted mt-3 text-center text-sm">
            Tap a player to transfer them out, or an empty shirt to add one. Like for like: a
            defender out, a defender in.
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
          <StatsTable
            rows={visible}
            columns={statColumns}
            defaultSort="pts"
            tiebreak={(p) => statPoints(p.id)}
            rowTint={(p) => inSquad(p.id)}
            lead={(p) => {
              const slot = benchSlot(p.id);
              return (
                <label className="flex min-h-[44px] min-w-0 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0 accent-[#d91414]"
                    aria-label={`Pick ${p.name}`}
                    checked={inSquad(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-bold">{p.name}</span>
                    <span className="muted flex min-w-0 items-center gap-1 text-xs">
                      <PosBadge position={p.position} />
                      <span className="truncate">
                        {sideById.get(p.side_id)?.short_name}
                        {' · '}
                        {nextFor(p) === 'No game' ? 'No game' : nextFor(p)}
                        {slot >= 0 && ` · ${slot === 0 ? 'sub GK' : `sub ${slot}`}`}
                        {!p.active && ' · unavailable'}
                      </span>
                    </span>
                  </span>
                </label>
              );
            }}
          />
        </>
      )}

      {/* Save stays in reach: sitting on the tab bar on phones (64px tabs + border +
          safe area), pinned at the bottom on desktop. */}
      {showProblems && problemsOpen && (
        <ul className="fixed inset-x-3 bottom-[calc(8rem+env(safe-area-inset-bottom))] z-30 list-disc space-y-1 rounded-xl border border-[#f2c27a] bg-[#fff4e5] py-2 pl-7 pr-3 text-sm font-semibold text-[#6b3d00] shadow-card dark:border-[#7a5a24] dark:bg-[#2b2113] dark:text-[#f5d9a8] sm:static sm:mb-2">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="fixed inset-x-0 bottom-[calc(4rem+1px+env(safe-area-inset-bottom))] z-20 flex items-center gap-3 border-t border-line bg-surface py-1.5 pl-4 pr-2 sm:sticky sm:bottom-4 sm:mt-4 sm:rounded-2xl sm:border sm:pr-3 sm:shadow-card">
        {showProblems ? (
          // Rules broken: say so here instead of the numbers; tap for the full list.
          <button
            type="button"
            onClick={() => setProblemsOpen(!problemsOpen)}
            aria-expanded={problemsOpen}
            className="flex min-h-tap min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold leading-tight text-[#8a4b00] dark:text-[#ffc773]"
          >
            <span aria-hidden="true">⚠</span>
            <span className="line-clamp-2 min-w-0">
              {problems[0]}
              {problems.length > 1 && ` (+${problems.length - 1} more)`}
            </span>
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 gap-3.5">
            {barStats.map(([label, value, warn]) => (
              <span key={label} className="flex min-w-0 flex-col leading-none">
                <span className="text-[0.62rem] uppercase tracking-wider text-ink-soft">
                  {label}
                </span>
                <span className={`display-num mt-0.5 truncate text-lg ${warn ? 'text-brand' : ''}`}>
                  {value}
                </span>
              </span>
            ))}
          </div>
        )}
        <button
          type="button"
          className="btn shrink-0 px-5"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving' : 'Save'}
        </button>
      </div>
      <div className="h-16 sm:hidden" />

      {overlays}
    </>
  );
}

// Pick team's pitch: the screen's height less the title bar, gameweek line,
// chips, view switch, subs and (once changed) the save button, with a floor so
// short screens scroll rather than squash.
const PICK_FIELD = {
  idle: 'h-[max(18rem,calc(100dvh-20.5rem-env(safe-area-inset-bottom)-env(safe-area-inset-top)))]',
  saving:
    'h-[max(18rem,calc(100dvh-24.25rem-env(safe-area-inset-bottom)-env(safe-area-inset-top)))]',
};
