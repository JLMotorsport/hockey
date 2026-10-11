import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StatsTable } from '@/components/StatsTable';
import { ErrorText, Loading } from '@/components/ui';
import { PlayerSheet } from '@/features/player/PlayerDetail';
import { usePlayerColumns } from '@/features/player/statColumns';
import { fixtureLabel } from '@/lib/form';
import { nextOpenGameweek, useFixtures, useGameweeks, usePlayers, useSides } from '@/lib/queries';
import { POSITIONS, type Position } from '@/lib/scoring';
import { Pills } from './V3Bits';
import { POSITION_RING } from './positions';

const POS_OPTIONS = [['', 'All'], ...POSITIONS.map((p) => [p, p] as const)] as const;

/** V3 Players (board "Players"): every player's stats, sortable, swipe for more columns. */
export function V3Players() {
  const [params] = useSearchParams();
  const sortParam = params.get('sort');
  const [open, setOpen] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [pos, setPos] = useState<Position | ''>('');
  const [side, setSide] = useState('');
  const players = usePlayers();
  const sides = useSides();
  const fixtures = useFixtures();
  const gameweeks = useGameweeks();
  const { columns, points } = usePlayerColumns();
  if (players.isLoading || sides.isLoading) return <Loading />;
  if (players.error) return <ErrorText error={players.error} />;

  const next = nextOpenGameweek(gameweeks.data ?? []);
  const sideShort = new Map((sides.data ?? []).map((s) => [s.id, s.short_name]));
  const term = search.trim().toLowerCase();
  const list = (players.data ?? [])
    .filter((p) => p.active)
    .filter((p) => !pos || p.position === pos)
    .filter((p) => !side || String(p.side_id) === side)
    .filter((p) => !term || p.name.toLowerCase().includes(term));

  return (
    <div className="mx-auto max-w-[26rem] pb-4">
      <header className="flex items-center justify-between gap-3 px-[18px] pb-2.5 pt-1.5">
        <span className="v3-disp text-[26px]">Players</span>
        <span className="flex items-center gap-2">
          <select
            aria-label="Side"
            value={side}
            onChange={(e) => setSide(e.target.value)}
            className="v3-disp min-h-[44px] rounded-[14px] border border-white/10 bg-white/[0.07] px-3 text-[13px] text-white"
          >
            <option value="">All sides</option>
            {(sides.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.short_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="Search players"
            aria-pressed={searching}
            onClick={() => {
              setSearching(!searching);
              if (searching) setSearch('');
            }}
            className="v3-icon"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
          </button>
        </span>
      </header>
      {searching && (
        <div className="px-3.5 pb-2.5">
          <input
            type="search"
            autoFocus
            aria-label="Search players"
            placeholder="Search players"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="v3-glass min-h-[48px] w-full rounded-2xl px-4 text-base text-white outline-none placeholder:text-[rgb(var(--v3-mut))]"
          />
        </div>
      )}
      <Pills label="Position" options={POS_OPTIONS} value={pos} onChange={setPos} />
      <div className="v3-glass mx-3.5 overflow-hidden rounded-[20px] [&_.card]:!m-0 [&_.card]:!border-0 [&_.card]:!bg-transparent [&_.card]:!shadow-none">
        <StatsTable
          rows={list}
          columns={columns}
          defaultSort={sortParam === 'change' ? 'change' : 'pts'}
          tiebreak={(p) => points(p.id)}
          lead={(p) => {
            const nextLabel = next ? fixtureLabel(fixtures.data ?? [], p.side_id, next.id) : null;
            return (
              <button
                type="button"
                onClick={() => setOpen(p.id)}
                className="flex min-h-[48px] w-full min-w-0 items-center gap-2 text-left"
              >
                <span
                  className="v3-disp flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[#0d1118] text-[11px]"
                  style={{
                    border: `1.5px solid ${POSITION_RING[p.position]}`,
                    boxShadow: `0 0 10px -2px ${POSITION_RING[p.position]}`,
                  }}
                >
                  {initials(p.name)}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-bold">{p.name}</span>
                  <span className="truncate text-[10px] text-[rgb(var(--v3-mut))]">
                    {p.position} · {sideShort.get(p.side_id)}
                    {nextLabel && ` · ${nextLabel}`}
                  </span>
                </span>
              </button>
            );
          }}
        />
      </div>
      {open && <PlayerSheet playerId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
