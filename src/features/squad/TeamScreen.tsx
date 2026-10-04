import { useParams, useSearchParams } from 'react-router-dom';
import { ErrorText, Loading } from '@/components/ui';
import { gameweekLabel } from '@/lib/format';
import {
  lockedGameweeks,
  useGameweeks,
  usePlayers,
  useProfile,
  useSides,
  useSquad,
} from '@/lib/queries';
import { SquadList } from './SquadList';

export function TeamScreen() {
  const { userId } = useParams();
  const [params, setParams] = useSearchParams();
  const profile = useProfile(userId);
  const gameweeks = useGameweeks();
  const players = usePlayers();
  const sides = useSides();
  const all = gameweeks.data ?? [];
  const locked = lockedGameweeks(all);
  const wanted = Number(params.get('gw'));
  const gameweek = locked.find((g) => g.id === wanted) ?? locked.at(-1);
  const squad = useSquad(userId, gameweek?.id);

  if (profile.isLoading || gameweeks.isLoading) return <Loading />;
  if (profile.error) return <ErrorText error={profile.error} />;

  return (
    <>
      <h1>
        {profile.data?.team_name}{' '}
        <small className="muted text-base font-normal">{profile.data?.display_name}</small>
      </h1>
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
          <div className="card">
            {squad.isLoading ? (
              <Loading />
            ) : squad.data?.length ? (
              <SquadList
                rows={squad.data}
                players={players.data ?? []}
                sides={sides.data ?? []}
                showPoints
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
