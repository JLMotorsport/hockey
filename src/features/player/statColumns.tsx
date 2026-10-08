import { PriceTrend } from '@/components/ui';
import type { StatColumn } from '@/components/StatsTable';
import { formByPlayer } from '@/lib/form';
import { NO_STATS } from '@/lib/playerStats';
import {
  lockedGameweeks,
  useAllGameweekPoints,
  useGameweeks,
  usePlayerStats,
  usePriceTrend,
  useSeasonPoints,
  type Player,
} from '@/lib/queries';
import { formatPrice } from '@/lib/squad';
import { priceChange } from '@/lib/pickDisplay';

const card = (colour: string) => (
  <span
    aria-hidden="true"
    className={`inline-block h-3 w-2.5 rounded-[2px] align-[-1px] ${colour}`}
  />
);

/** The stat columns shared by Players and the Transfers list. */
export function usePlayerColumns<T extends Pick<Player, 'id' | 'price'>>(): {
  columns: StatColumn<T>[];
  points: (id: number) => number;
} {
  const seasonPoints = useSeasonPoints();
  const trend = usePriceTrend();
  const gameweeks = useGameweeks();
  const gwPoints = useAllGameweekPoints();
  const stats = usePlayerStats();
  const locked = lockedGameweeks(gameweeks.data ?? []);
  const last = locked.at(-1);
  const form = formByPlayer(
    gwPoints.data ?? [],
    locked.map((g) => g.id),
  );
  const lastPts = new Map(
    (gwPoints.data ?? [])
      .filter((r) => r.gameweek_id === last?.id)
      .map((r) => [r.player_id, r.points]),
  );
  const points = (id: number) => seasonPoints.data?.get(id) ?? 0;
  const st = (id: number) => stats.data?.get(id) ?? NO_STATS;
  const lastLabel = last ? `GW${locked.length}` : 'GW';

  const columns: StatColumn<T>[] = [
    { key: 'pts', label: 'Pts', title: 'Total points', value: (p) => points(p.id) },
    {
      key: 'price',
      label: 'Price',
      title: 'Price',
      value: (p) => p.price,
      render: (p) => (
        <>
          {formatPrice(p.price)}
          <PriceTrend change={trend.data?.get(p.id)} />
        </>
      ),
    },
    {
      key: 'change',
      label: '+/-',
      title: 'Price change this week',
      value: (p) => trend.data?.get(p.id) ?? 0,
      render: (p) => priceChange(trend.data?.get(p.id)),
    },
    {
      key: 'form',
      label: 'Form',
      title: 'Form (average points, last 3 games)',
      value: (p) => form.get(p.id) ?? null,
      render: (p) => form.get(p.id)?.toFixed(1) ?? '-',
    },
    {
      key: 'gw',
      label: lastLabel,
      title: `Points in ${lastLabel}`,
      value: (p) => lastPts.get(p.id) ?? null,
    },
    {
      key: 'ppg',
      label: 'Pts/G',
      title: 'Points per game',
      value: (p) => (st(p.id).apps ? points(p.id) / st(p.id).apps : null),
      render: (p) => (st(p.id).apps ? (points(p.id) / st(p.id).apps).toFixed(1) : '-'),
    },
    { key: 'apps', label: 'Apps', title: 'Appearances', value: (p) => st(p.id).apps },
    { key: 'goals', label: 'Goals', title: 'Goals', value: (p) => st(p.id).goals },
    { key: 'assists', label: 'Ast', title: 'Assists', value: (p) => st(p.id).assists },
    { key: 'cs', label: 'CS', title: 'Clean sheets', value: (p) => st(p.id).cleanSheets },
    { key: 'potm', label: 'POTM', title: 'Player of the match', value: (p) => st(p.id).potm },
    {
      key: 'green',
      label: card('bg-[#1f9d55]'),
      title: 'Green cards',
      value: (p) => st(p.id).green,
    },
    {
      key: 'yellow',
      label: card('bg-[#f5c400]'),
      title: 'Yellow cards',
      value: (p) => st(p.id).yellow,
    },
    {
      key: 'red',
      label: card('bg-[#d91414]'),
      title: 'Red cards',
      value: (p) => st(p.id).red,
    },
  ];
  return { columns, points };
}
