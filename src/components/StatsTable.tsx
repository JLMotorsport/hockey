import { Fragment, useState, type ReactNode } from 'react';
import { sortBy, type SortDir } from '@/lib/playerStats';

export interface StatColumn<T> {
  key: string;
  label: ReactNode;
  /** Spelled out for screen readers and the header's tooltip. */
  title: string;
  value: (row: T) => number | null;
  render?: (row: T) => ReactNode;
}

/**
 * A stats table like FPL's: the first column (who) stays put while the stat
 * columns scroll sideways. Tap a column heading to sort by it, again to flip.
 */
export function StatsTable<T extends { id: number }>({
  rows,
  columns,
  lead,
  leadLabel = 'Player',
  defaultSort,
  tiebreak,
  rowTint,
  empty = 'No players match.',
  groups,
}: {
  rows: T[];
  columns: StatColumn<T>[];
  /** The fixed first cell: name, side, position, a checkbox... */
  lead: (row: T) => ReactNode;
  leadLabel?: string;
  defaultSort: string;
  tiebreak?: (row: T) => number;
  /** Highlight a row (e.g. picked); applied to the fixed cell too. */
  rowTint?: (row: T) => boolean;
  empty?: string;
  /** Rows in titled sections (as FPL's list of your 15), sorted within each. */
  groups?: { title: string; rows: T[]; tone?: string }[];
}) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({
    key: defaultSort,
    dir: 'desc',
  });
  const column = columns.find((c) => c.key === sort.key) ?? columns[0]!;
  const sections = (groups ?? [{ title: '', rows }]).map((g) => ({
    ...g,
    rows: sortBy(g.rows, column.value, sort.dir, tiebreak),
  }));
  const count = sections.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="card overflow-hidden !p-0">
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="sticky left-0 z-10 w-[10.5rem] min-w-[10.5rem] bg-surface px-3 py-2 text-left font-display text-xs font-bold uppercase tracking-wide text-ink-soft shadow-[6px_0_6px_-6px_rgb(0_0_0_/_0.35)]">
                {leadLabel}
                <span className="ml-1 font-sans text-[0.65rem] font-normal normal-case tracking-normal sm:hidden">
                  swipe for more →
                </span>
              </th>
              {columns.map((c) => {
                const on = c.key === column.key;
                return (
                  <th
                    key={c.key}
                    className="min-w-[3.4rem] px-1 py-0 text-right"
                    aria-sort={on ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}
                  >
                    <button
                      type="button"
                      title={c.title}
                      aria-label={`Sort by ${c.title}`}
                      onClick={() =>
                        setSort(
                          on
                            ? { key: c.key, dir: sort.dir === 'desc' ? 'asc' : 'desc' }
                            : { key: c.key, dir: 'desc' },
                        )
                      }
                      className={`inline-flex min-h-tap w-full items-center justify-end gap-0.5 whitespace-nowrap px-1 font-display text-xs font-bold uppercase tracking-wide ${on ? 'text-brand' : 'text-ink-soft'}`}
                    >
                      {c.label}
                      <span aria-hidden="true" className="text-[0.6rem]">
                        {on ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sections.map((g) => (
              <Fragment key={g.title}>
                {g.title && (
                  <tr>
                    <th
                      colSpan={columns.length + 1}
                      className={`px-3 pb-1 pt-2 text-left font-display text-[0.95rem] font-extrabold uppercase ${g.tone ?? ''}`}
                    >
                      <span className="sticky left-3">{g.title}</span>
                    </th>
                  </tr>
                )}
                {g.rows.map((r) => {
                  const tint = rowTint?.(r) ?? false;
                  return (
                    <tr key={r.id} className={`border-b border-line ${tint ? 'bg-brand/5' : ''}`}>
                      <td
                        className={`sticky left-0 z-10 w-[10.5rem] min-w-[10.5rem] max-w-[10.5rem] px-3 py-1.5 shadow-[6px_0_6px_-6px_rgb(0_0_0_/_0.35)] ${tint ? 'bg-[color-mix(in_srgb,rgb(var(--surface))_95%,rgb(var(--brand)))]' : 'bg-surface'}`}
                      >
                        {lead(r)}
                      </td>
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className={`whitespace-nowrap px-2 text-right tabular-nums ${c.key === column.key ? 'font-bold' : ''}`}
                        >
                          {c.render ? c.render(r) : (c.value(r) ?? '-')}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
            {!count && (
              <tr>
                <td colSpan={columns.length + 1} className="muted px-4 py-4">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
