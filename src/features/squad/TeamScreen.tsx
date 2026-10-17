import { useParams, useSearchParams } from 'react-router-dom';
import { ErrorText, Loading } from '@/components/ui';
import { gameweekLabel } from '@/lib/format';
import {
  scoringGameweeks,
  useSettings,
  useGameweeks,
  usePlayers,
  useProfile,
  useSides,
  squadTotal,
  useChips,
  useSquad,
  transferSummaryQuery,
} from '@/lib/queries';
import { useQuery } from '@tanstack/react-query';
import { liveGameweek } from '@/lib/home';
import { SquadPitch } from './SquadPitch';

export function TeamScreen() {
  const { userId } = useParams();
  const [params, setParams] = useSearchParams();
  const profile = useProfile(userId);
  const gameweeks = useGameweeks();
  const players = usePlayers();
  const sides = useSides();
  const all = gameweeks.data ?? [];
  const settings = useSettings();
  const locked = scoringGameweeks(all, settings.data?.scoring_from);
  const wanted = Number(params.get('gw'));
  const gameweek = locked.find((g) => g.id === wanted) ?? locked.at(-1);
  const squad = useSquad(userId, gameweek?.id);
  const chips = useChips(userId);
  const hit = useQuery(transferSummaryQuery(userId, gameweek?.id)).data?.hit ?? 0;

  if (profile.isLoading || gameweeks.isLoading) return <Loading />;
  if (profile.error) return <ErrorText error={profile.error} />;

  return (
    <>
      <section className="hero">
        <p className="font-display text-sm font-bold uppercase tracking-widest text-white/80">
          {profile.data?.display_name}
        </p>
        <h1 className="mb-0 mt-0 text-4xl">{profile.data?.team_name}</h1>
        {squad.data?.length ? (
          <p className="mt-2 font-display text-xl font-bold uppercase">
            {squadTotal(squad.data) - hit} points
            {hit > 0 && <span className="ml-2 text-sm text-white/80">(-{hit} transfers)</span>}
          </p>
        ) : null}
      </section>
      {!gameweek ? (
        <p className="muted">Squads are revealed once the first deadline passes.</p>
      ) : (
        <>
          <label className="field max-w-xs">
            Gameweek
            <select
              className="input"
              value={gameweek.id}
              onChange={(e) => setParams({ gw: e.target.value })}
            >
              {locked.map((g) => (
                <option key={g.id} value={g.id}>
                  {gameweekLabel(g, all)}
                </option>
              ))}
            </select>
          </label>
          <div>
            {squad.isLoading ? (
              <Loading />
            ) : squad.data?.length ? (
              <SquadPitch
                gameweekId={gameweek.id}
                chip={chips.data?.find((c) => c.gameweek_id === gameweek.id)}
                rows={squad.data}
                players={players.data ?? []}
                sides={sides.data ?? []}
                showPoints
                // The live weekend: each player's fixture until their match has synced.
                live={gameweek.id === liveGameweek(all)?.id}
              />
            ) : (
              <p className="muted">No squad for this gameweek.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}
