import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Loading, Notices, type Notice } from '@/components/ui';
import { formatDayTime, formatShortDate, toUkInputValue } from '@/lib/format';
import {
  keys,
  nextOpenGameweek,
  useFixtures,
  useGameweekPricing,
  useGameweeks,
  type Gameweek,
} from '@/lib/queries';
import { errorLines, requireSupabase } from '@/lib/supabase';
import { PageHead, panel } from './adminUi';

type Status = 'Finished' | 'Next' | 'Upcoming' | 'No games';
const STATUS: Record<Status, string> = {
  Finished: 'bg-line text-[#3a404b] dark:text-[#c8ced8]',
  Next: 'bg-[#e6f4ec] dark:bg-[#123d27] text-[#155c39] dark:text-[#8ee0b0]',
  Upcoming: 'bg-surface text-ink-soft ring-1 ring-line',
  'No games': 'bg-[#fff1dc] dark:bg-[#4a3010] text-[#7a4600] dark:text-[#ffc773]',
};

export function GameweeksScreen() {
  const gameweeks = useGameweeks();
  const fixtures = useFixtures();
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [notices, setNotices] = useState<Notice[]>([]);
  if (gameweeks.isLoading) return <Loading />;

  const all = gameweeks.data ?? [];
  const next = nextOpenGameweek(all);
  const games = (gw: Gameweek) =>
    (fixtures.data ?? []).filter((f) => f.gameweek_id === gw.id).length;
  const statusOf = (gw: Gameweek): Status =>
    gw.id === next?.id
      ? 'Next'
      : new Date(gw.deadline) <= new Date()
        ? 'Finished'
        : games(gw)
          ? 'Upcoming'
          : 'No games';

  async function save(id: number) {
    const value = edits[id];
    if (!value) return;
    const { error } = await requireSupabase().rpc('set_deadline', {
      p_gameweek_id: id,
      p_deadline: value,
    });
    if (error) setNotices(errorLines(error).map((text) => ({ kind: 'error', text })));
    else {
      setNotices([{ kind: 'success', text: 'Deadline saved.' }]);
      const rest = { ...edits };
      delete rest[id];
      setEdits(rest);
      await queryClient.invalidateQueries({ queryKey: keys.gameweeks });
    }
  }

  return (
    <>
      <PageHead
        title="Gameweeks"
        sub="Made automatically, one per weekend. Deadlines lock squads: Saturday 10:00, or an hour before a midweek game. A deadline you set can only be brought earlier by a midweek game."
      />
      <Notices items={notices} />
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <section className={`${panel} overflow-hidden`}>
          <div className="hidden grid-cols-[56px_1fr_290px_80px_110px] gap-3 border-b border-line px-[18px] py-3 text-xs font-bold uppercase tracking-wider text-ink-soft lg:grid">
            <span>GW</span>
            <span>Weekend</span>
            <span>Deadline</span>
            <span className="text-right">Fixtures</span>
            <span>Status</span>
          </div>
          {all.map((gw, i) => {
            const status = statusOf(gw);
            const past = status === 'Finished';
            const edited = edits[gw.id] !== undefined;
            return (
              <div
                key={gw.id}
                className={`grid grid-cols-[40px_1fr_auto] items-center gap-x-3 gap-y-2 border-b border-line px-3.5 py-2.5 lg:min-h-[54px] lg:grid-cols-[56px_1fr_290px_80px_110px] lg:px-[18px] lg:py-1.5 ${status === 'Next' ? 'bg-[#f2faf5] dark:bg-[#15291f]' : ''}`}
              >
                <span className="font-display text-[22px] font-extrabold">{i + 1}</span>
                <span className="text-[15px] font-semibold">
                  {formatShortDate(gw.start_date)}
                  <span className="muted block text-xs font-normal lg:hidden">
                    {past ? formatDayTime(gw.deadline) : `${games(gw)} fixtures`}
                  </span>
                </span>
                <span className="col-start-3 row-start-1 lg:hidden">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS[status]}`}
                  >
                    {status}
                  </span>
                </span>
                {past ? (
                  <span className="hidden text-[15px] text-[#8a909b] lg:block">
                    {formatDayTime(gw.deadline)}
                  </span>
                ) : (
                  <span className="col-span-3 flex gap-2 lg:col-span-1">
                    <input
                      type="datetime-local"
                      aria-label={`Deadline for GW${i + 1}`}
                      className="min-h-tap flex-1 rounded-lg border border-line bg-surface px-2.5 text-base lg:min-h-[38px] lg:text-[15px]"
                      value={edits[gw.id] ?? toUkInputValue(gw.deadline)}
                      onChange={(e) => setEdits({ ...edits, [gw.id]: e.target.value })}
                    />
                    {edited && (
                      <button type="button" className="btn btn-sm" onClick={() => void save(gw.id)}>
                        Save
                      </button>
                    )}
                  </span>
                )}
                <span className="hidden text-right text-[15px] lg:block">{games(gw)}</span>
                <span className="hidden lg:block">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS[status]}`}
                  >
                    {status}
                  </span>
                </span>
              </div>
            );
          })}
          {!all.length && (
            <p className="muted p-4">No gameweeks yet. They appear with the first sync.</p>
          )}
        </section>
        <PricesPanels onDone={setNotices} />
      </div>
    </>
  );
}

function PricesPanels({ onDone }: { onDone: (notices: Notice[]) => void }) {
  const queryClient = useQueryClient();
  const pricing = useGameweekPricing();
  const gameweeks = useGameweeks();
  const [busy, setBusy] = useState(false);
  const started = (pricing.data?.length ?? 0) > 0;
  const all = gameweeks.data ?? [];
  const lastPriced = all.filter((g) => pricing.data?.some((p) => p.gameweek_id === g.id)).at(-1);
  const lastNumber = lastPriced ? all.indexOf(lastPriced) + 1 : null;

  async function run(kind: 'start' | 'weekly') {
    if (
      kind === 'start' &&
      !window.confirm(
        started
          ? 'Reset every price from points so far? This replaces the current prices, including any you set by hand.'
          : "Set every player's price from their points so far?",
      )
    ) {
      return;
    }
    setBusy(true);
    const db = requireSupabase();
    const result =
      kind === 'start'
        ? await db.rpc('set_prices_from_points')
        : await db.rpc('apply_due_price_changes');
    setBusy(false);
    if (result.error) {
      onDone(errorLines(result.error).map((text) => ({ kind: 'error', text })));
      return;
    }
    const data = result.data as number | { weeks?: number; changes?: number };
    onDone([
      {
        kind: 'success',
        text:
          typeof data === 'number'
            ? `Priced ${data} players from their points. Prices now move each week with form.`
            : data.weeks
              ? `${data.changes} price changes over ${data.weeks} gameweek(s).`
              : "No price changes due yet. They run once a gameweek's weekend is over.",
      },
    ]);
    await queryClient.invalidateQueries();
  }

  const big =
    'min-h-[48px] w-full rounded-full font-display text-base font-extrabold uppercase disabled:opacity-60 lg:min-h-tap lg:text-[15px]';
  return (
    <div className="flex flex-col gap-3.5">
      {started && (
        <section className={`${panel} flex flex-col gap-2.5 p-4 lg:p-[18px]`}>
          <h2 className="m-0 font-display text-xl font-extrabold uppercase lg:text-[22px]">
            Price changes
          </h2>
          <p className="muted m-0 text-sm leading-snug">
            After each gameweek, players who played move up or down by up to 0.3m on how they scored
            against everyone&apos;s average. That runs on its own with the sync.
            {lastNumber && ` Done up to GW${lastNumber}.`}
          </p>
          <button
            type="button"
            className={`${big} bg-brand text-white`}
            disabled={busy}
            onClick={() => void run('weekly')}
          >
            Apply now
          </button>
        </section>
      )}
      <section
        className={`${panel} flex-col gap-2.5 border-t-4 border-t-[#b26a00] p-4 lg:flex lg:p-[18px] ${started ? 'hidden' : 'flex'}`}
      >
        <h2 className="m-0 font-display text-xl font-extrabold uppercase lg:text-[22px]">
          {started ? 'Reset prices' : 'Set prices'}
        </h2>
        <p className="muted m-0 text-sm leading-snug">
          Sets every price from points so far, everyone ranked together from 4.0m to 10.0m. Squads
          keep the price they paid.
        </p>
        <button
          type="button"
          className={`${big} bg-surface ring-1 ring-line`}
          disabled={busy}
          onClick={() => void run('start')}
        >
          {started ? 'Reset from points' : 'Set from points'}
        </button>
      </section>
      {started && (
        <p className="muted m-0 text-center text-xs lg:hidden">
          Reset prices is laptop only, as it changes every price at once.
        </p>
      )}
    </div>
  );
}
