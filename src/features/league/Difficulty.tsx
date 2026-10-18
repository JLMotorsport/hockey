import { FDR_COLOURS, sideRun, type Difficulty, type FdrFixture, type RunCell } from '@/lib/fdr';
import { gameweekLabel } from '@/lib/format';
import type { Side } from '@/lib/queries';

type Place = { position: number; teams: number };

/** The super user's reminder that nobody else can see difficulty yet. */
export function PreviewStrip() {
  return (
    <p className="mb-3 flex min-h-[30px] items-center gap-2 rounded-lg bg-[#fff1d6] px-2.5 py-1 text-xs font-bold text-[#7a4b00] dark:bg-[#3a2a06] dark:text-[#ffb547]">
      <span className="rounded bg-[#ffb547] px-1.5 py-0.5 font-display text-xs font-extrabold uppercase text-[#0e1014]">
        Preview
      </span>
      Only you can see difficulty until you switch it on
    </p>
  );
}

/** A rating chip: colour and number, so colour isn't the only signal. */
export function FdrBadge({ rating, className = '' }: { rating: Difficulty; className?: string }) {
  const c = FDR_COLOURS[rating];
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] font-extrabold ${className}`}
      style={{ background: c.bg, color: c.fg }}
      aria-label={`Difficulty ${rating} of 5`}
    >
      {rating}
    </span>
  );
}

/** One cell of a run: opponent and H or A, coloured by difficulty. */
export function RunChip({ cell, compact = false }: { cell: RunCell; compact?: boolean }) {
  if (!cell.code)
    return (
      <span
        className={`flex items-center justify-center rounded-md bg-[#eef0f3] font-bold text-[#8a909b] dark:bg-[#1f232c] dark:text-[#6b7280] ${compact ? 'h-[30px]' : 'min-h-[32px]'}`}
        aria-label="No game"
      >
        -
      </span>
    );
  const c = cell.rating ? FDR_COLOURS[cell.rating] : null;
  const label = `${cell.opponent} ${cell.home ? 'home' : 'away'}${cell.rating ? `, difficulty ${cell.rating} of 5` : ''}`;
  return compact ? (
    <span
      className={`flex h-[30px] flex-col items-center justify-center rounded-[5px] leading-none ${c ? '' : 'bg-[#eef0f3] text-ink-soft dark:bg-[#1f232c]'}`}
      style={c ? { background: c.bg, color: c.fg } : undefined}
      aria-label={label}
    >
      <span className="text-[10px] font-extrabold [font-stretch:75%]">{cell.code}</span>
      <span className="text-[9px] font-bold opacity-85">{cell.home ? 'H' : 'A'}</span>
    </span>
  ) : (
    <span
      className={`flex min-h-[32px] items-center justify-center rounded-md text-[0.78rem] font-extrabold [font-stretch:80%] ${c ? '' : 'bg-[#eef0f3] text-ink-soft dark:bg-[#1f232c]'}`}
      style={c ? { background: c.bg, color: c.fg } : undefined}
      aria-label={label}
    >
      {cell.code} ({cell.home ? 'H' : 'A'})
    </span>
  );
}

/** Each side's next three, coloured by how hard the opponent is, with the key. */
export function DifficultyGrid({
  sides,
  fixtures,
  gameweeks,
  upcoming,
  places,
}: {
  sides: Side[];
  fixtures: FdrFixture[];
  gameweeks: { id: number; start_date: string; deadline: string }[];
  upcoming: { id: number; start_date: string; deadline: string }[];
  places: Map<number, Place>;
}) {
  const next = upcoming.slice(0, 3);
  if (!next.length) return null;
  if (!places.size)
    return (
      <p className="card muted text-sm">
        No league tables yet. They arrive with the next sync from England Hockey.
      </p>
    );
  const cols = { gridTemplateColumns: `2.75rem repeat(${next.length}, minmax(0, 1fr))` };
  return (
    <>
      <section className="card !px-3 !py-1.5">
        <div
          className="grid gap-[5px] py-1.5 font-display text-[11px] font-extrabold uppercase text-ink-soft"
          style={cols}
        >
          <span>Side</span>
          {next.map((g) => (
            <span key={g.id} className="text-center">
              {gameweekLabel(g, gameweeks).split(' ')[0]}
            </span>
          ))}
        </div>
        {sides.map((side) => (
          <div key={side.id} className="grid min-h-[38px] items-center gap-[5px]" style={cols}>
            <span className="font-display text-[15px] font-extrabold uppercase">
              {side.short_name}
            </span>
            {sideRun(
              fixtures,
              side.id,
              next.map((g) => g.id),
              places,
            ).map((cell, i) => (
              <RunChip key={i} cell={cell} />
            ))}
          </div>
        ))}
      </section>
      <div className="mb-2 flex items-center gap-1.5 px-0.5 text-xs text-ink-soft">
        <span>Easier</span>
        {([1, 2, 3, 4, 5] as Difficulty[]).map((n) => (
          <span
            key={n}
            className="flex h-6 w-[30px] items-center justify-center rounded-[5px] font-extrabold"
            style={{ background: FDR_COLOURS[n].bg, color: FDR_COLOURS[n].fg }}
          >
            {n}
          </span>
        ))}
        <span>Harder</span>
      </div>
      <p className="muted mb-4 px-1 text-xs leading-snug">
        From each league table on England Hockey. An opponent in the top quarter of the table is a
        4, the bottom quarter a 1, and an away game adds 1, so only a top side away is a 5. A dash
        means no game.
      </p>
    </>
  );
}
