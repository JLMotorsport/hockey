import { useQueries } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ErrorText, Loading } from '@/components/ui';
import { PlayerSheet } from '@/features/player/PlayerDetail';
import { useAuth } from '@/lib/auth/AuthProvider';
import { chipName } from '@/lib/chips';
import { defaultGameweek } from '@/lib/gameweek';
import { formatWeekdayTime } from '@/lib/format';
import { myPlace, ordinal, weekSpread } from '@/lib/home';
import {
  keys,
  lockedGameweeks,
  nextOpenGameweek,
  squadTotal,
  useChips,
  useGameweeks,
  useLeagueTable,
  usePlayers,
  useProfile,
  useSides,
} from '@/lib/queries';
import { requireSupabase } from '@/lib/supabase';
import { TeamPitch } from './TeamPitch';
import { useSquadBadges } from './useSquadBadges';

/**
 * V3 Points (board "Points (swipe through weeks)"): your team, gameweek by
 * gameweek, with the next one (fixtures, not points) at the end. With a
 * :userId it shows another manager's team, past deadlines only.
 */
export function V3Points() {
  const { userId: other } = useParams();
  const { session } = useAuth();
  const userId = other ?? session?.user.id;
  const mine = !other || other === session?.user.id;
  const profile = useProfile(userId);
  const gameweeks = useGameweeks();
  const players = usePlayers();
  const sides = useSides();
  const table = useLeagueTable();
  const chips = useChips(userId);
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<number | null>(null);
  const onOpen = useCallback((id: number) => setOpen(id), []);
  const all = gameweeks.data ?? [];
  const locked = lockedGameweeks(all);
  const next = nextOpenGameweek(all);
  // Your own team shows the next gameweek too; someone else's only after its deadline.
  const browsable = mine && next ? [...locked, next] : locked;
  const viewing =
    browsable.find((g) => g.id === Number(params.get('gw'))) ??
    locked.at(-1) ??
    defaultGameweek(browsable);
  const index = viewing ? browsable.findIndex((g) => g.id === viewing.id) : -1;
  const upcoming = Boolean(viewing && next && viewing.id === next.id);
  const history = useQueries({
    queries: browsable.map((gw) => ({
      queryKey: keys.squad(userId ?? '', gw.id),
      enabled: Boolean(userId),
      queryFn: async () => {
        const { data, error } = await requireSupabase().rpc('squad_for', {
          p_user: userId as string,
          p_gameweek: gw.id,
        });
        if (error) throw error;
        return data;
      },
    })),
  });
  const rows = index >= 0 ? (history[index]?.data ?? undefined) : undefined;
  const badges = useSquadBadges(rows, players.data ?? [], sides.data ?? [], viewing?.id, onOpen);
  const touch = useRef<number | null>(null);

  if (!userId) return <Navigate to="/login" replace />;
  if (gameweeks.isLoading || players.isLoading || sides.isLoading) return <Loading />;
  if (gameweeks.error) return <ErrorText error={gameweeks.error} />;

  const go = (i: number) => {
    const gw = browsable[i];
    if (gw) setParams({ gw: String(gw.id) }, { replace: true });
  };
  const number = (id: number) => {
    const gw = all.find((g) => g.id === id);
    return gw ? all.filter((g) => g.start_date <= gw.start_date).length : 0;
  };
  const tableRows = table.data ?? [];
  const latest = locked.at(-1);
  const isLatest = viewing && latest && viewing.id === latest.id;
  const spread = weekSpread(tableRows);
  const place = myPlace(tableRows, () => true, userId);
  const chip = chips.data?.find((c) => c.gameweek_id === viewing?.id);
  const weeks = locked.map((g) => ({
    g,
    pts: squadTotal(history[browsable.findIndex((b) => b.id === g.id)]?.data),
  }));
  const best = Math.max(1, ...weeks.map((w) => w.pts));
  const season = weeks.reduce((n, w) => n + w.pts, 0);

  return (
    <div
      className="mx-auto max-w-[26rem]"
      onTouchStart={(e) => (touch.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const start = touch.current;
        const end = e.changedTouches[0]?.clientX;
        touch.current = null;
        if (start === null || end === undefined || Math.abs(end - start) < 60) return;
        go(end < start ? index + 1 : index - 1);
      }}
    >
      <header className="flex items-center justify-between px-3.5 pb-1.5 pt-1">
        <button
          type="button"
          aria-label="Previous gameweek"
          disabled={index <= 0}
          onClick={() => go(index - 1)}
          className="v3-icon text-lg disabled:opacity-30"
        >
          ‹
        </button>
        <span className="min-w-0 text-center">
          <span className="v3-cap block truncate">
            {mine ? 'Points · swipe for other weeks' : (profile.data?.team_name ?? 'Team')}
          </span>
          <span className="v3-disp text-[26px]">
            {viewing ? `Gameweek ${number(viewing.id)}` : 'No gameweeks yet'}
          </span>
        </span>
        <button
          type="button"
          aria-label="Next gameweek"
          disabled={index >= browsable.length - 1}
          onClick={() => go(index + 1)}
          className="v3-icon text-lg disabled:opacity-30"
        >
          ›
        </button>
      </header>

      {!viewing ? (
        <p className="v3-glass mx-3.5 rounded-[20px] p-4 text-sm">
          Squads are revealed once the first deadline passes.
        </p>
      ) : (
        <>
          <div className="mb-1 flex items-end justify-center gap-6">
            <span className="text-center">
              <span className="v3-disp v3-num block text-[26px] text-[rgb(var(--v3-mut))]">
                {isLatest ? spread.average : '-'}
              </span>
              <span className="v3-cap">Avg</span>
            </span>
            <span className="text-center">
              {upcoming ? (
                <span className="v3-disp block pb-1 pt-3 text-[26px] leading-tight">
                  {formatWeekdayTime(viewing.deadline)}
                </span>
              ) : (
                <span className="v3-disp v3-num block text-[60px] [text-shadow:0_0_26px_rgb(255_51_71/.5)]">
                  {squadTotal(rows)}
                </span>
              )}
              <span className="v3-cap text-[rgb(var(--v3-ice))]">
                {upcoming ? 'Deadline' : 'Points'}
              </span>
            </span>
            <span className="text-center">
              <span className="v3-disp v3-num block text-[26px]">
                {place ? ordinal(place.rank) : '-'}
              </span>
              <span className="v3-cap">Rank</span>
            </span>
          </div>
          {chip && (
            <div className="mb-2 flex justify-center">
              <span className="rounded-full border border-[rgb(255_51_71/.45)] bg-[rgb(255_51_71/.14)] px-3 py-1.5 text-xs font-bold text-[#ffb3bb]">
                {chipName(chip.chip)} played
              </span>
            </div>
          )}
          {rows?.length ? (
            <div className="px-3">
              <TeamPitch rows={badges.pitch} bench={badges.bench} height={372} />
              <div className="h-[92px]" />
            </div>
          ) : (
            <div className="v3-glass mx-3.5 rounded-[20px] p-4 text-center text-sm">
              {upcoming ? (
                <>
                  No squad picked yet.{' '}
                  <Link to="/transfers" className="font-bold text-[rgb(var(--v3-red))]">
                    Pick your squad
                  </Link>
                </>
              ) : (
                'No squad this gameweek.'
              )}
            </div>
          )}
          {weeks.length > 0 && (
            <>
              <div className="mx-[18px] mb-2 mt-4 flex items-baseline justify-between">
                <span className="v3-cap">Season</span>
                <span className="text-[11px] text-[rgb(var(--v3-mut))]">{season} pts</span>
              </div>
              <div className="flex h-[96px] items-end gap-2 overflow-x-auto px-[18px] [scrollbar-width:none]">
                {weeks.map(({ g, pts }) => {
                  const on = g.id === viewing.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => go(browsable.findIndex((b) => b.id === g.id))}
                      className="flex min-w-[40px] flex-1 flex-col items-center gap-1"
                      aria-label={`Gameweek ${number(g.id)}: ${pts} points`}
                    >
                      <span className="v3-num text-[11px]">{pts}</span>
                      <span
                        className={`w-full rounded-t-[7px] rounded-b-[3px] ${on ? 'bg-[linear-gradient(180deg,#ff6b7a,#d9142a)] shadow-[0_0_14px_rgb(255_51_71/.5)]' : 'bg-white/[0.14]'}`}
                        style={{ height: Math.max(4, Math.round((pts / best) * 56)) }}
                      />
                      <span className="v3-cap text-[9px]">GW{number(g.id)}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
      {open && (
        <PlayerSheet
          playerId={open}
          gameweekId={upcoming ? undefined : viewing?.id}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
