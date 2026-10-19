import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorText, Loading } from '@/components/ui';
import { gameweekLabel } from '@/lib/format';
import { missingRpc, useGameweeks, useSides } from '@/lib/queries';
import { formatPrice } from '@/lib/squad';
import { requireSupabase } from '@/lib/supabase';
import { PageHead, panel } from './adminUi';

/**
 * Monday's price changes, live over the weekend (0038): each player who
 * played in the gameweek waiting to be priced, and the price the Monday
 * update would give them from the points so far. Managers only.
 */
export function PricesScreen() {
  const [show, setShow] = useState<'up' | 'down'>('up');
  const gameweeks = useGameweeks();
  const sides = useSides();
  const preview = useQuery({
    queryKey: ['price-preview'],
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('price_preview');
      if (error) {
        if (missingRpc(error)) return [];
        throw new Error(error.message);
      }
      return data ?? [];
    },
  });
  if (preview.isLoading || gameweeks.isLoading) return <Loading />;
  if (preview.error) return <ErrorText error={preview.error} />;

  const rows = preview.data ?? [];
  const gw = (gameweeks.data ?? []).find((g) => g.id === rows[0]?.gameweek_id);
  const side = new Map((sides.data ?? []).map((s) => [s.id, s.short_name]));
  const move = (r: (typeof rows)[number]) => r.new_price - r.old_price;
  const up = rows
    .filter((r) => move(r) > 0)
    .sort((a, b) => move(b) - move(a) || b.points - a.points);
  const down = rows
    .filter((r) => move(r) < 0)
    .sort((a, b) => move(a) - move(b) || a.points - b.points);
  const list = show === 'up' ? up : down;

  return (
    <>
      <PageHead title="Monday's prices" />
      {!gw ? (
        <p className="muted">
          No gameweek is waiting for its price changes. They show here once the weekend&apos;s
          results start coming in.
        </p>
      ) : (
        <div className="max-w-xl space-y-2.5">
          <p className="muted m-0 text-[13px]">
            {gameweekLabel(gw, gameweeks.data ?? []).split(' ')[0]} so far. Prices change Monday at
            9am, from the final points.
          </p>
          <div className={`${panel} grid grid-cols-3 py-2 text-center`}>
            <span>
              <b className="display-num block text-xl">{rows[0]!.average}</b>
              <span className="muted text-[0.65rem] uppercase">Avg points</span>
            </span>
            <span>
              <b className="display-num block text-xl text-[#1f7a4d] dark:text-[#5fd39a]">
                {up.length}
              </b>
              <span className="muted text-[0.65rem] uppercase">Rising</span>
            </span>
            <span>
              <b className="display-num block text-xl text-[#b3261e] dark:text-[#ff8a80]">
                {down.length}
              </b>
              <span className="muted text-[0.65rem] uppercase">Falling</span>
            </span>
          </div>
          <div
            className="flex rounded-[10px] bg-black/[0.06] p-[3px] dark:bg-[#1f232c]"
            role="tablist"
          >
            {(
              [
                ['up', 'Rising'],
                ['down', 'Falling'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={show === key}
                onClick={() => setShow(key)}
                className={`min-h-tap flex-1 rounded-lg font-bold ${show === key ? 'bg-[#14181f] text-white dark:bg-[#eceff4] dark:text-[#0e1014]' : 'text-ink-soft'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <ul className={`${panel} overflow-hidden`}>
            {list.map((r) => (
              <li
                key={r.player_id}
                className="flex min-h-[56px] items-center gap-2.5 border-t border-line px-3 first:border-0"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-bold">{r.name}</span>
                  <span className="muted text-xs">
                    {side.get(r.side_id)} · {r.points} pts · in {r.owned}{' '}
                    {r.owned === 1 ? 'squad' : 'squads'}
                  </span>
                </span>
                <span className="muted whitespace-nowrap text-[13px]">
                  {formatPrice(r.old_price)}m →{' '}
                  <b className="text-ink">{formatPrice(r.new_price)}m</b>
                </span>
                <span
                  className={`min-w-[44px] rounded-md py-0.5 text-center text-[13px] font-extrabold ${move(r) > 0 ? 'bg-[#e6f4ec] text-[#155c39] dark:bg-[#123d27] dark:text-[#8ee0b0]' : 'bg-[#fde8e8] text-[#9b1c1c] dark:bg-[#4a1616] dark:text-[#ff9a9a]'}`}
                >
                  {move(r) > 0 ? '+' : '-'}
                  {formatPrice(Math.abs(move(r)))}
                </span>
              </li>
            ))}
            {!list.length && (
              <li className="muted p-4 text-sm">
                Nobody {show === 'up' ? 'rising' : 'falling'} so far.
              </li>
            )}
          </ul>
          <p className="muted px-0.5 text-[11.5px] leading-snug">
            Points against the gameweek&apos;s average: 4+ above +0.3m, 2+ above +0.2m, half a point
            above +0.1m; 1+ below -0.1m, 3+ below -0.2m. Only managers see this.
          </p>
        </div>
      )}
    </>
  );
}
