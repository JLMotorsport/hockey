import { useMemo, useState } from 'react';
import { formatPrice, type SquadPlayer } from '@/lib/squad';
import type { Side } from '@/lib/queries';
import type { Position } from '@/lib/scoring';
import { POSITION_RING } from './positions';

// V3's market (board "Add a player"): a drawer over the page with the bank,
// search, an affordable-only switch and players best first. A side you
// already have the maximum from shows as full.

export function V3Market({
  title,
  candidates,
  bank,
  sides,
  sideCounts,
  maxPerSide,
  nextFor,
  points,
  onPick,
  onStats,
  onClose,
}: {
  title: string;
  candidates: SquadPlayer[];
  bank: number;
  sides: Side[];
  sideCounts: Map<number, number>;
  maxPerSide: number;
  nextFor: (p: SquadPlayer) => string;
  points: (id: number) => number;
  onPick: (id: number) => void;
  onStats: (id: number) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [affordable, setAffordable] = useState(true);
  const short = useMemo(() => new Map(sides.map((s) => [s.id, s.short_name])), [sides]);
  const q = search.trim().toLowerCase();
  const list = candidates.filter(
    (p) => (!q || p.name.toLowerCase().includes(q)) && (!affordable || p.price <= bank),
  );
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-[3px]"
      />
      <div className="relative flex max-h-[88dvh] flex-col rounded-t-[28px] border-t border-white/10 bg-[rgb(12_15_22/.97)] px-3.5 pb-[max(12px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-20px_50px_rgb(0_0_0/.6)]">
        <div className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-white/20" />
        <div className="mb-2.5 flex items-center justify-between">
          <span className="v3-disp text-[24px]">{title}</span>
          <button type="button" onClick={onClose} className="v3-icon" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="mb-2.5 flex justify-between rounded-2xl border border-[rgb(63_242_168/.3)] bg-[rgb(63_242_168/.1)] px-3.5 py-2.5 text-[13px]">
          <span>In the bank</span>
          <span className="v3-num text-[15px] text-[rgb(var(--v3-mint))]">
            {formatPrice(bank)}m
          </span>
        </div>
        <div className="mb-1.5 flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players"
            aria-label="Search players"
            className="min-h-[44px] flex-1 rounded-[14px] border border-white/10 bg-white/[0.06] px-3 text-[14px] text-white placeholder:text-[rgb(var(--v3-mut))]"
          />
          <button
            type="button"
            aria-pressed={affordable}
            onClick={() => setAffordable(!affordable)}
            className={`min-h-[44px] rounded-[14px] border px-3 text-xs font-bold ${affordable ? 'border-[rgb(255_51_71/.4)] bg-[rgb(255_51_71/.14)] text-[#ffb3bb]' : 'border-white/10 text-[rgb(var(--v3-mut))]'}`}
          >
            {affordable ? `≤ ${formatPrice(bank)}m` : 'Any price'}
          </button>
        </div>
        <ul className="-mx-1 overflow-y-auto px-1">
          {list.map((p, i) => {
            const full = (sideCounts.get(p.side_id) ?? 0) >= maxPerSide;
            return (
              <li
                key={p.id}
                className={`v3-in flex min-h-[58px] items-center gap-3 border-b border-white/[0.08] ${full ? 'opacity-45' : ''}`}
                style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
              >
                <Ring position={p.position} label={initials(p.name)} />
                <button
                  type="button"
                  onClick={() => onStats(p.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-[14px] font-bold">{p.name}</span>
                  <span className="block truncate text-[11px] text-[rgb(var(--v3-mut))]">
                    {short.get(p.side_id)} · {nextFor(p)}
                  </span>
                </button>
                <span className="min-w-[48px] text-right">
                  <span className="v3-num block text-[15px]">{formatPrice(p.price)}m</span>
                  <span className="v3-num block text-[11px] text-[rgb(var(--v3-mint))]">
                    {points(p.id)} pts
                  </span>
                </span>
                {full ? (
                  <span className="v3-cap w-11 text-center text-[9px]">Side full</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onPick(p.id)}
                    aria-label={`Add ${p.name}`}
                    className="flex h-11 w-11 items-center justify-center rounded-xl border border-[rgb(63_242_168/.4)] bg-[rgb(63_242_168/.14)] text-lg font-bold text-[rgb(var(--v3-mint))]"
                  >
                    +
                  </button>
                )}
              </li>
            );
          })}
          {!list.length && (
            <li className="py-6 text-center text-sm text-[rgb(var(--v3-mut))]">
              {affordable
                ? 'Nobody fits the bank. Tap the price switch to see everyone.'
                : 'No players match.'}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.at(-1)?.[0] ?? '')).toUpperCase();
}

function Ring({ position, label }: { position: Position; label: string }) {
  const ring = POSITION_RING[position];
  return (
    <span
      className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[#0d1118] text-[11px] font-extrabold"
      style={{ border: `1.5px solid ${ring}`, boxShadow: `0 0 12px -2px ${ring}88` }}
    >
      {label}
    </span>
  );
}
