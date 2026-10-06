// This morning's Players page (6 Oct), kept behind the V1/V2 switch for testing.
import { useState } from 'react';
import { ErrorText, Loading, PosBadge, PriceTrend } from '@/components/ui';
import { fixtureLabel, formByPlayer } from '@/lib/form';
import {
  lockedGameweeks,
  nextOpenGameweek,
  useAllGameweekPoints,
  usePriceTrend,
  useFixtures,
  useGameweeks,
  usePlayers,
  useSeasonPoints,
  useSides,
} from '@/lib/queries';
import { POSITIONS, type Position } from '@/lib/scoring';
import { formatPrice } from '@/lib/squad';
import { PlayerSheet } from '@/features/player/PlayerDetail';

export function PlayersScreenV1() {
  const [open, setOpen] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<Position | ''>('');
  const [side, setSide] = useState('');
  const [sort, setSort] = useState<'points' | 'price' | 'form'>('points');
  const players = usePlayers();
  const sides = useSides();
  const points = useSeasonPoints();
  const trend = usePriceTrend();
  const fixtures = useFixtures();
  const gameweeks = useGameweeks();
  const gameweekPoints = useAllGameweekPoints();
  if (players.isLoading || sides.isLoading || points.isLoading) return <Loading />;
  if (players.error) return <ErrorText error={players.error} />;
  const all = gameweeks.data ?? [];
  const next = nextOpenGameweek(all);
  const sideShort = new Map((sides.data ?? []).map((s) => [s.id, s.short_name]));
  const form = formByPlayer(
    gameweekPoints.data ?? [],
    lockedGameweeks(all).map((g) => g.id),
  );
  const pts = (id: number) => points.data?.get(id) ?? 0;
  const term = search.trim().toLowerCase();
  const list = (players.data ?? [])
    .filter((p) => p.active)
    .filter((p) => !pos || p.position === pos)
    .filter((p) => !side || String(p.side_id) === side)
    .filter((p) => !term || p.name.toLowerCase().includes(term))
    .sort((a, b) =>
      sort === 'price'
        ? b.price - a.price || pts(b.id) - pts(a.id)
        : sort === 'form'
          ? (form.get(b.id) ?? -1) - (form.get(a.id) ?? -1) || pts(b.id) - pts(a.id)
          : pts(b.id) - pts(a.id) || b.price - a.price,
    );

  return (
    <>
      <h1>Players</h1>
      <div className="mb-3 space-y-2">
        <label className="flex min-h-[46px] items-center gap-2 rounded-xl border border-line bg-surface px-3">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5 text-ink-soft"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <span className="sr-only">Search players</span>
          <input
            type="search"
            className="min-w-0 flex-1 bg-transparent text-base outline-none"
            placeholder="Search players"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="flex gap-1.5 overflow-x-auto" role="radiogroup" aria-label="Position">
          {(['', ...POSITIONS] as const).map((p) => (
            <button
              key={p || 'all'}
              type="button"
              role="radio"
              aria-checked={pos === p}
              onClick={() => setPos(p)}
              className={`min-h-[36px] shrink-0 rounded-full px-3 font-display text-sm font-bold ${pos === p ? 'bg-[#16181d] text-white' : 'bg-surface ring-1 ring-line'}`}
            >
              {p || 'All'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            className="input"
            aria-label="Side"
            value={side}
            onChange={(e) => setSide(e.target.value)}
          >
            <option value="">All sides</option>
            {(sides.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            className="input"
            aria-label="Sort by"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            <option value="points">Sort: points</option>
            <option value="price">Sort: price</option>
            <option value="form">Sort: form</option>
          </select>
        </div>
      </div>
      <div className="card !p-0">
        <div className="grid grid-cols-[1fr_3.25rem_2.75rem_2.75rem] gap-1.5 border-b border-line px-4 py-2 font-display text-xs font-bold uppercase tracking-wide text-ink-soft">
          <span>Player</span>
          <span className="text-right">Price</span>
          <span className="text-right">Form</span>
          <span className="text-right">Pts</span>
        </div>
        <ul>
          {list.map((p) => {
            const nextLabel = next ? fixtureLabel(fixtures.data ?? [], p.side_id, next.id) : null;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setOpen(p.id)}
                  className="grid min-h-[54px] w-full grid-cols-[1fr_3.25rem_2.75rem_2.75rem] items-center gap-1.5 border-b border-line px-4 py-1.5 text-left"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-bold">{p.name}</span>
                    <span className="muted flex items-center gap-1.5 truncate text-xs">
                      <PosBadge position={p.position} />
                      {sideShort.get(p.side_id)}
                      {nextLabel && ` · ${nextLabel}`}
                    </span>
                  </span>
                  <span className="text-right tabular-nums">
                    {formatPrice(p.price)}
                    <PriceTrend change={trend.data?.get(p.id)} />
                  </span>
                  <span className="muted text-right tabular-nums">
                    {form.get(p.id)?.toFixed(1) ?? '-'}
                  </span>
                  <span className="display-num text-right text-xl">{pts(p.id)}</span>
                </button>
              </li>
            );
          })}
          {!list.length && <li className="muted px-4 py-4">No players match.</li>}
        </ul>
      </div>
      {open && <PlayerSheet playerId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
