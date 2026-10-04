import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorText, Loading, Notices, PosBadge, type Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { formatDayTime, gameweekLabel } from '@/lib/format';
import {
  keys,
  nextOpenGameweek,
  useGameweeks,
  usePlayers,
  useSeasonPoints,
  useSettings,
  useSides,
  useSquad,
} from '@/lib/queries';
import { POSITIONS } from '@/lib/scoring';
import { formatPrice, summariseSquad, type SquadPlayer } from '@/lib/squad';
import { errorLines, requireSupabase } from '@/lib/supabase';

export function SquadScreen() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const gameweeks = useGameweeks();
  const players = usePlayers();
  const sides = useSides();
  const settings = useSettings();
  const points = useSeasonPoints();

  const all = gameweeks.data ?? [];
  const gameweek = nextOpenGameweek(all);
  const previousGw = gameweek
    ? [...all].reverse().find((g) => g.start_date < gameweek.start_date)
    : undefined;
  const userId = session?.user.id;
  const current = useSquad(userId, gameweek?.id);
  const previous = useSquad(userId, previousGw?.id);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [captainId, setCaptainId] = useState<number | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<number | null>(null);
  const [sideFilter, setSideFilter] = useState('');
  const [posFilter, setPosFilter] = useState('');
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [saving, setSaving] = useState(false);

  // Start from the saved squad once it arrives.
  useEffect(() => {
    if (!gameweek || !current.data || loadedFrom === gameweek.id) return;
    setSelected(new Set(current.data.map((r) => r.player_id)));
    setCaptainId(current.data.find((r) => r.is_captain)?.player_id ?? null);
    setLoadedFrom(gameweek.id);
  }, [gameweek, current.data, loadedFrom]);

  const sideById = useMemo(() => new Map((sides.data ?? []).map((s) => [s.id, s])), [sides.data]);
  const currentIds = useMemo(() => (current.data ?? []).map((r) => r.player_id), [current.data]);
  const previousIds = useMemo(() => (previous.data ?? []).map((r) => r.player_id), [previous.data]);

  const pool: SquadPlayer[] = useMemo(
    () =>
      (players.data ?? [])
        .filter((p) => p.active || currentIds.includes(p.id))
        .map((p) => ({
          id: p.id,
          name: p.name,
          position: p.position,
          side_id: p.side_id,
          side_name: sideById.get(p.side_id)?.name ?? '',
          price: p.price,
          active: p.active,
        }))
        .sort(
          (a, b) =>
            (sideById.get(a.side_id)?.sort_order ?? 0) -
              (sideById.get(b.side_id)?.sort_order ?? 0) ||
            POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) ||
            a.name.localeCompare(b.name),
        ),
    [players.data, currentIds, sideById],
  );

  if (!session) return <Navigate to="/login" replace />;
  if (gameweeks.isLoading || players.isLoading || sides.isLoading || settings.isLoading)
    return <Loading />;
  if (players.error) return <ErrorText error={players.error} />;
  if (!gameweek) {
    return (
      <>
        <h1>Pick your squad</h1>
        <p className="muted">
          There&apos;s no upcoming gameweek yet. A manager needs to sync or add fixtures.
        </p>
      </>
    );
  }
  const s = settings.data!;
  const picked = pool.filter((p) => selected.has(p.id));
  const summary = summariseSquad(picked, captainId, s, currentIds, previousIds);

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
      if (captainId === id) setCaptainId(null);
    } else next.add(id);
    setSelected(next);
  }

  async function save() {
    setSaving(true);
    const { error } = await requireSupabase().rpc('save_squad', {
      p_player_ids: [...selected],
      p_captain_id: captainId ?? 0,
    });
    setSaving(false);
    if (error) {
      setNotices(errorLines(error).map((text) => ({ kind: 'error', text })));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['squad'] });
    await queryClient.invalidateQueries({ queryKey: keys.table });
    navigate('/dashboard');
  }

  const visible = pool.filter(
    (p) =>
      (!sideFilter || String(p.side_id) === sideFilter) &&
      (!posFilter || p.position === posFilter) &&
      (!onlyPicked || selected.has(p.id)),
  );

  return (
    <>
      <h1>
        Pick your squad{' '}
        <small className="muted text-base font-normal">for {gameweekLabel(gameweek, all)}</small>
      </h1>
      <p className="muted">
        Deadline {formatDayTime(gameweek.deadline)}. Changes after that apply to the following
        gameweek.
      </p>
      <Notices items={notices} />

      <div className="card sticky top-0 z-10 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div>
          <strong>{summary.count}</strong>/{s.squad_size} players
        </div>
        <div>
          {POSITIONS.map((pos) => (
            <span key={pos} className="mr-2">
              {pos} <strong>{summary.byPosition[pos]}</strong>
            </span>
          ))}
        </div>
        <div className={summary.cost > s.budget ? 'text-red-700' : ''}>
          Spent <strong>{formatPrice(summary.cost)}</strong>m of {formatPrice(s.budget)}m
        </div>
        {summary.transfers !== null && (
          <div>
            Transfers <strong>{summary.transfers}</strong>/{s.transfers_per_gameweek}
          </div>
        )}
        <button type="button" className="btn ml-auto" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving' : 'Save squad'}
        </button>
      </div>
      {summary.problems.length > 0 && selected.size > 0 && (
        <ul className="muted mb-3 list-disc pl-5 text-sm">
          {summary.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <p className="muted text-sm">
        1 goalkeeper, at least 3 defenders, 3 midfielders and 1 forward. Max {s.max_per_side} from
        any one Felixstowe side. Captain scores double.
      </p>

      <div className="my-3 flex flex-wrap items-center gap-2">
        <select
          className="input-inline"
          aria-label="Filter by side"
          value={sideFilter}
          onChange={(e) => setSideFilter(e.target.value)}
        >
          <option value="">All sides</option>
          {(sides.data ?? []).map((side) => (
            <option key={side.id} value={side.id}>
              {side.name}
            </option>
          ))}
        </select>
        <select
          className="input-inline"
          aria-label="Filter by position"
          value={posFilter}
          onChange={(e) => setPosFilter(e.target.value)}
        >
          <option value="">All positions</option>
          {POSITIONS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyPicked}
            onChange={(e) => setOnlyPicked(e.target.checked)}
          />{' '}
          Only my picks
        </label>
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Pick</th>
              <th>Captain</th>
              <th>Player</th>
              <th>Pos</th>
              <th>Side</th>
              <th className="num">Price</th>
              <th className="num">Pts</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => {
              const isPicked = selected.has(p.id);
              return (
                <tr key={p.id} className={isPicked ? 'bg-brand/10' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      aria-label={`Pick ${p.name}`}
                      checked={isPicked}
                      onChange={() => toggle(p.id)}
                    />
                  </td>
                  <td>
                    <input
                      type="radio"
                      name="captain"
                      className="h-5 w-5"
                      aria-label={`Captain ${p.name}`}
                      disabled={!isPicked}
                      checked={captainId === p.id}
                      onChange={() => setCaptainId(p.id)}
                    />
                  </td>
                  <td>
                    {p.name}
                    {!p.active && <span className="muted"> (unavailable)</span>}
                  </td>
                  <td>
                    <PosBadge position={p.position} />
                  </td>
                  <td>{sideById.get(p.side_id)?.short_name}</td>
                  <td className="num">{formatPrice(p.price)}</td>
                  <td className="num">{points.data?.get(p.id) ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
