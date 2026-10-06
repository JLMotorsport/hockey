import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
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
import { chipName } from '@/lib/chips';
import { StatsTable } from '@/components/StatsTable';
import { usePlayerColumns } from '@/features/player/statColumns';
import { POSITION_NAMES, POSITIONS, type Position } from '@/lib/scoring';
import { DEFAULT_FORMATIONS, formationOf, pitchRows } from '@/lib/formation';
import { Pitch, Shirt, type PitchSlot } from '@/components/Pitch';
import { Sheet } from '@/components/Sheet';
import { PlayerDetail, PlayerSheet } from '@/features/player/PlayerDetail';
import {
  autoArrange,
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
        .filter((p) => !sideFilter || String(p.side_id) === sideFilter)
        .sort(
          (a, b) =>
            (points.data?.get(b.id) ?? 0) - (points.data?.get(a.id) ?? 0) || b.price - a.price,
        )
    : [];

  // Transfers: the 15 by position, price above each, empty slots up to FPL's
  // 2 GK, 5 DEF, 5 MID, 3 FWD while the squad isn't full.
  const squadPlayers = [...picked, ...benchPlayers.filter((p): p is SquadPlayer => p !== null)];
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
            only={mode === 'pick' ? ['triple_captain', 'rolling_subs', 'team_bus'] : ['wildcard']}
          />
        </Sheet>
      )}

      {mode === 'pick' && empty ? (
        <section className="card text-center">
          <h2>No squad yet</h2>
          <p className="muted mb-3">Pick your 15 players on Transfers first.</p>
          <Link className="btn" to="/transfers">
            Go to transfers
          </Link>
        </section>
      ) : mode === 'transfers' && view === 'pitch' ? (
        <>
          {freeFix && (
            <p className="mb-3 rounded-xl border border-[#9cc3ea] bg-[#eaf3fc] px-3 py-2 text-sm font-semibold text-[#123a5e] dark:border-[#2c4f73] dark:bg-[#14263a] dark:text-[#cfe3f7]">
              Squads are now 2 GK, 5 DEF, 5 MID and 3 FWD. Changes this week to get yours there are
              free: tap a player to swap them for a position you&apos;re short of.
            </p>
          )}
          <Pitch rows={transferRows} compact />
          <p className="muted mt-3 text-center text-sm">
            Tap a player to transfer them out, or an empty shirt to add one. Like for like: a
            defender out, a defender in.
          </p>
        </>
      ) : mode === 'pick' ? (
        <>
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
          <Pitch rows={slots} bench={benchSlots} compact />
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
          disabled={saving || (mode === 'pick' && empty)}
          onClick={() => void save()}
        >
          {saving ? 'Saving' : mode === 'transfers' ? 'Save' : 'Save team'}
        </button>
      </div>
      <div className="h-16 sm:hidden" />

      {picker && (
        <Sheet
          title={
            picker.positions.length > 1
              ? 'Choose a replacement'
              : picker.slot === undefined
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
}
