import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { ErrorText, Loading } from '@/components/ui';
import { chipName } from '@/lib/chips';
import { gameweekLabel } from '@/lib/format';
import { liveGameweek, ordinal } from '@/lib/home';
import {
  scoringGameweeks,
  squadTotal,
  transferSummaryQuery,
  useChips,
  useGameweeks,
  useLeagueTable,
  usePlayers,
  useProfile,
  useSettings,
  useSides,
  useSquad,
} from '@/lib/queries';
import { ArrowButton } from './ArrowButton';
import { SquadPitch } from './SquadPitch';

/**
 * Someone's team, laid out like your own Points page: whose team at the top
 * of the red scoreboard, then their points for the week (arrows step through
 * the gameweeks whose deadline has passed), their total and position.
 */
export function TeamScreen() {
  const { userId } = useParams();
  const [params, setParams] = useSearchParams();
  const profile = useProfile(userId);
  const gameweeks = useGameweeks();
  const players = usePlayers();
  const sides = useSides();
  const table = useLeagueTable();
  const all = gameweeks.data ?? [];
  const settings = useSettings();
  const locked = scoringGameweeks(all, settings.data?.scoring_from);
  const viewing = locked.find((g) => g.id === Number(params.get('gw'))) ?? locked.at(-1);
  const index = viewing ? locked.findIndex((g) => g.id === viewing.id) : -1;
  const squad = useSquad(userId, viewing?.id);
  const chips = useChips(userId);
  const hit = useQuery(transferSummaryQuery(userId, viewing?.id)).data?.hit ?? 0;

  if (profile.isLoading || gameweeks.isLoading) return <Loading />;
  if (profile.error) return <ErrorText error={profile.error} />;

  const row = table.data?.find((r) => r.user_id === userId);
  const side = sides.data?.find((s) => s.id === profile.data?.side_id);
  const chip = chips.data?.find((c) => c.gameweek_id === viewing?.id);
  const go = (i: number) => {
    const gw = locked[i];
    if (gw) setParams({ gw: String(gw.id) }, { replace: true });
  };
  const label = viewing ? gameweekLabel(viewing, all) : '';

  return (
    <>
      <section className="hero !mb-2 !pb-2 !pt-3">
        <div className="flex items-center gap-3">
          <span className="flex h-[3.1rem] w-[3.1rem] shrink-0 items-center justify-center rounded-xl bg-white">
            <img src="/crest.png" alt="" className="h-10 w-10" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h1 className="m-0 truncate text-[1.45rem] leading-tight">{profile.data?.team_name}</h1>
            <span className="truncate text-sm text-white/90">
              {profile.data?.display_name}
              {side && ` · plays for ${side.short_name}`}
            </span>
          </span>
        </div>
        <div className="my-2.5 h-px bg-white/25" />
        {viewing ? (
          <div className="flex items-center gap-1.5">
            <ArrowButton
              label="Previous gameweek"
              disabled={index <= 0}
              onClick={() => go(index - 1)}
              d="M15 6l-6 6 6 6"
            />
            <div className="flex min-w-0 flex-1 items-center justify-center gap-3">
              <div className="flex flex-col items-center leading-none">
                <span className="font-display text-xs font-bold uppercase text-white/85">
                  {`${label.split(' ')[0]} · ${label.replace(/^GW\d+ /, '').replace(/[()]/g, '')}`}
                </span>
                <span className="display-num text-[2.9rem] leading-[0.95]">
                  {squad.data?.length ? squadTotal(squad.data) - hit : '-'}
                </span>
                <span className="text-[0.7rem] text-white/85">
                  {hit ? `points (-${hit} transfers)` : 'points'}
                </span>
              </div>
              <div className="flex min-w-0 flex-col gap-1 border-l border-white/30 pl-3 text-xs">
                <span>
                  <span className="text-white/80">Total</span>{' '}
                  <b className="display-num text-lg">{row?.total ?? 0}</b>
                </span>
                <span className="whitespace-nowrap">
                  <span className="text-white/80">Position</span>{' '}
                  <b className="display-num text-lg">{row?.rank ? ordinal(row.rank) : '-'}</b>
                  <span className="text-white/80"> of {table.data?.length ?? 0}</span>
                </span>
                {chip && (
                  <span className="self-start rounded-full bg-black/25 px-2 py-px text-[0.7rem]">
                    {chipName(chip.chip)}
                  </span>
                )}
              </div>
            </div>
            <ArrowButton
              label="Next gameweek"
              disabled={index >= locked.length - 1}
              onClick={() => go(index + 1)}
              d="M9 6l6 6-6 6"
            />
          </div>
        ) : (
          <p className="m-0 text-center text-sm text-white/90">
            Squads are revealed once the first deadline passes.
          </p>
        )}
      </section>

      {viewing && (
        <section className="mb-4">
          {squad.isLoading ? (
            <Loading />
          ) : squad.data?.length ? (
            <SquadPitch
              rows={squad.data}
              players={players.data ?? []}
              sides={sides.data ?? []}
              showPoints
              gameweekId={viewing.id}
              chip={chip}
              // The live weekend: each player's fixture until their match has synced.
              live={viewing.id === liveGameweek(all)?.id}
              compact
            />
          ) : (
            <p className="card muted text-center">No squad this gameweek.</p>
          )}
        </section>
      )}
    </>
  );
}
