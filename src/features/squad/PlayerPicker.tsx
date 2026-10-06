import { useEffect, useState } from 'react';
import { PosBadge } from '@/components/ui';
import { StatsTable } from '@/components/StatsTable';
import { usePlayerColumns } from '@/features/player/statColumns';
import type { Side } from '@/lib/queries';
import { formatPrice, type SquadPlayer } from '@/lib/squad';

const PRICE_CAPS = [100, 90, 80, 70, 60, 50];

/**
 * Add Player, full screen as in FPL: bank on top, search and filters, then
 * every candidate with stats that scroll sideways. Tap a name to add them.
 */
export function PlayerPicker({
  title,
  candidates,
  bank,
  sides,
  sideCounts,
  maxPerSide,
  showPosition,
  nextFor,
  onPick,
  onStats,
  onClose,
}: {
  title: string;
  /** Allowed positions, not already picked, active. */
  candidates: SquadPlayer[];
  bank: number;
  sides: Side[];
  /** How many of the squad each side already has. */
  sideCounts: Map<number, number>;
  maxPerSide: number;
  /** More than one position allowed: show each player's. */
  showPosition: boolean;
  nextFor: (p: SquadPlayer) => string;
  onPick: (id: number) => void;
  onStats: (id: number) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [side, setSide] = useState('');
  // 'bank': only players you can afford; a number: price cap (tenths).
  const [cap, setCap] = useState<'all' | 'bank' | number>('all');
  const { columns, points } = usePlayerColumns<SquadPlayer>();
  const sideShort = new Map(sides.map((s) => [s.id, s.short_name]));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const term = search.trim().toLowerCase();
  const list = candidates
    .filter((p) => !side || String(p.side_id) === side)
    .filter((p) => !term || p.name.toLowerCase().includes(term))
    .filter((p) => (cap === 'all' ? true : cap === 'bank' ? p.price <= bank : p.price <= cap));
  const full = (p: SquadPlayer) => (sideCounts.get(p.side_id) ?? 0) >= maxPerSide;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-paper"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="sticky top-0 z-20 bg-paper px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface shadow-card"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <h2 className="m-0 flex-1 text-center">{title}</h2>
          <span className="w-11" />
        </div>
        <p
          className={`mt-2 rounded-xl px-3 py-2 text-center font-display text-lg font-extrabold uppercase text-white ${bank < 0 ? 'bg-[#7a0b0b]' : 'bg-gradient-to-r from-brand to-brand-dark'}`}
        >
          Bank {formatPrice(bank)}m
        </p>
        <label className="mt-2 flex min-h-[46px] items-center gap-2 rounded-xl border border-line bg-surface px-3">
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
          <span className="sr-only">Search by name</span>
          <input
            type="search"
            className="min-w-0 flex-1 bg-transparent text-base outline-none"
            placeholder="Search by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <select
            className="input !mt-0"
            aria-label="Price"
            value={String(cap)}
            onChange={(e) =>
              setCap(
                e.target.value === 'all' || e.target.value === 'bank'
                  ? e.target.value
                  : Number(e.target.value),
              )
            }
          >
            <option value="all">Any price</option>
            <option value="bank">I can afford</option>
            {PRICE_CAPS.map((c) => (
              <option key={c} value={c}>
                Up to {formatPrice(c)}m
              </option>
            ))}
          </select>
          <select
            className="input !mt-0"
            aria-label="Side"
            value={side}
            onChange={(e) => setSide(e.target.value)}
          >
            <option value="">All sides</option>
            {sides.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="px-4 pb-8">
        <StatsTable
          rows={list}
          columns={columns}
          defaultSort="pts"
          tiebreak={(p) => points(p.id)}
          empty="No one matches. Try another side or price."
          lead={(p) => (
            <span className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={() => onStats(p.id)}
                aria-label={`Stats for ${p.name}`}
                className="flex h-11 w-7 shrink-0 items-center justify-center font-serif text-lg font-bold italic text-ink-soft"
              >
                i
              </button>
              <button
                type="button"
                onClick={() => onPick(p.id)}
                disabled={full(p)}
                className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center text-left disabled:opacity-50"
              >
                <span className="truncate font-bold">{p.name}</span>
                <span className="muted flex min-w-0 items-center gap-1 text-xs">
                  {showPosition && <PosBadge position={p.position} />}
                  <span className="truncate">
                    {sideShort.get(p.side_id)}
                    {' · '}
                    {full(p) ? `${maxPerSide} from this side already` : nextFor(p)}
                  </span>
                </span>
              </button>
            </span>
          )}
        />
      </div>
    </div>
  );
}
