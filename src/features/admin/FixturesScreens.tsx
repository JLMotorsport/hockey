import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorText, Loading, Notices, PosBadge, type Notice } from '@/components/ui';
import { formatDayTime, formatWeekdayTime, gameweekLabel } from '@/lib/format';
import {
  keys,
  useFixtureDetail,
  useFixtures,
  useGameweeks,
  usePlayers,
  useSides,
} from '@/lib/queries';
import { POSITIONS } from '@/lib/scoring';
import { errorLines, requireSupabase } from '@/lib/supabase';

export function AdminFixturesScreen() {
  const gameweeks = useGameweeks();
  const fixtures = useFixtures();
  const sides = useSides();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    side_id: '',
    opponent: '',
    kickoff: '',
    is_home: 'true',
    competition: '',
  });
  const [notices, setNotices] = useState<Notice[]>([]);

  if (gameweeks.isLoading || fixtures.isLoading || sides.isLoading) return <Loading />;
  const all = gameweeks.data ?? [];
  const sideName = new Map((sides.data ?? []).map((s) => [s.id, s.name]));

  async function add(e: FormEvent) {
    e.preventDefault();
    const { data, error } = await requireSupabase().rpc('add_fixture', {
      p_side_id: Number(form.side_id || sides.data?.[0]?.id),
      p_opponent: form.opponent,
      p_kickoff: form.kickoff,
      p_is_home: form.is_home === 'true',
      p_competition: form.competition,
    });
    if (error) {
      setNotices(errorLines(error).map((text) => ({ kind: 'error', text })));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: keys.fixtures });
    await queryClient.invalidateQueries({ queryKey: keys.gameweeks });
    navigate(`/manage/fixtures/${data}`);
  }

  return (
    <>
      <section className="card">
        <h2>Add a fixture by hand</h2>
        <p className="muted text-sm">
          For cups, friendlies, or anything not on England Hockey. Times are UK time.
        </p>
        <Notices items={notices} />
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => void add(e)}>
          <select
            className="input-inline"
            aria-label="Side"
            value={form.side_id}
            onChange={(e) => setForm({ ...form, side_id: e.target.value })}
          >
            {(sides.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            className="input-inline"
            placeholder="Opponent"
            required
            value={form.opponent}
            onChange={(e) => setForm({ ...form, opponent: e.target.value })}
          />
          <input
            className="input-inline"
            type="datetime-local"
            aria-label="Kickoff"
            required
            value={form.kickoff}
            onChange={(e) => setForm({ ...form, kickoff: e.target.value })}
          />
          <select
            className="input-inline"
            aria-label="Home or away"
            value={form.is_home}
            onChange={(e) => setForm({ ...form, is_home: e.target.value })}
          >
            <option value="true">Home</option>
            <option value="false">Away</option>
          </select>
          <input
            className="input-inline"
            placeholder="Competition (optional)"
            value={form.competition}
            onChange={(e) => setForm({ ...form, competition: e.target.value })}
          />
          <button className="btn btn-sm">Add</button>
        </form>
      </section>

      {all.map((gw) => {
        const list = (fixtures.data ?? []).filter((f) => f.gameweek_id === gw.id);
        if (!list.length) return null;
        return (
          <section key={gw.id} className="card">
            <h2>{gameweekLabel(gw, all)}</h2>
            <table className="table">
              <tbody>
                {list.map((f) => (
                  <tr key={f.id}>
                    <td className="muted whitespace-nowrap">{formatWeekdayTime(f.kickoff)}</td>
                    <td>
                      <Link to={`/manage/fixtures/${f.id}`}>
                        {sideName.get(f.side_id)} {f.is_home ? 'v' : '@'} {f.opponent}
                      </Link>
                      {!f.eh_fixture_id && <span className="tag ml-2">manual</span>}
                    </td>
                    <td className="num whitespace-nowrap">
                      {f.goals_for === null || f.goals_against === null
                        ? 'v'
                        : `${f.goals_for} - ${f.goals_against}`}
                    </td>
                    <td>
                      {f.stats_complete ? (
                        <span className="tag border-green-700 text-green-700">stats done</span>
                      ) : f.goals_for !== null ? (
                        <span className="tag border-amber-700 text-amber-700">needs stats</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      {!all.length && (
        <p className="muted">No fixtures yet. Use &quot;Sync from England Hockey&quot; above.</p>
      )}
    </>
  );
}

interface Line {
  played: boolean;
  goals: number;
  assists: number;
  green_cards: number;
  yellow_cards: number;
  red_cards: number;
}

const STAT_FIELDS = ['goals', 'assists', 'green_cards', 'yellow_cards', 'red_cards'] as const;
const STAT_LABELS = ['Goals', 'Assists', 'Green', 'Yellow', 'Red'];
const EMPTY: Line = {
  played: false,
  goals: 0,
  assists: 0,
  green_cards: 0,
  yellow_cards: 0,
  red_cards: 0,
};

export function AdminFixtureScreen() {
  const id = Number(useParams().id);
  const detail = useFixtureDetail(id);
  const players = usePlayers();
  const sides = useSides();
  const gameweeks = useGameweeks();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [lines, setLines] = useState<Map<number, Line>>(new Map());
  const [potm, setPotm] = useState<number | null>(null);
  const [score, setScore] = useState({ for: '', against: '' });
  const [complete, setComplete] = useState(false);
  const [extra, setExtra] = useState<number[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    if (!detail.data) return;
    const { fixture, performances } = detail.data;
    setLines(new Map(performances.map((p) => [p.player_id, { ...p, played: true }])));
    setPotm(performances.find((p) => p.player_of_match)?.player_id ?? null);
    setScore({
      for: fixture.goals_for?.toString() ?? '',
      against: fixture.goals_against?.toString() ?? '',
    });
    setComplete(fixture.stats_complete);
  }, [detail.data]);

  if (detail.isLoading || players.isLoading || sides.isLoading) return <Loading />;
  if (detail.error || !detail.data) return <ErrorText error={detail.error} />;
  const { fixture } = detail.data;
  const sideById = new Map((sides.data ?? []).map((s) => [s.id, s]));
  const gw = gameweeks.data?.find((g) => g.id === fixture.gameweek_id);
  const order = (a: { position: string; name: string }, b: { position: string; name: string }) =>
    POSITIONS.indexOf(a.position as never) - POSITIONS.indexOf(b.position as never) ||
    a.name.localeCompare(b.name);
  // This side's players, plus anyone from another side who played (covering).
  const shown = (players.data ?? [])
    .filter((p) => p.side_id === fixture.side_id || lines.has(p.id) || extra.includes(p.id))
    .sort(order);
  const others = (players.data ?? [])
    .filter((p) => p.active && p.side_id !== fixture.side_id && !shown.includes(p))
    .sort((a, b) => a.side_id - b.side_id || a.name.localeCompare(b.name));

  const line = (pid: number) => lines.get(pid) ?? EMPTY;
  function update(pid: number, patch: Partial<Line>) {
    const next = new Map(lines);
    const merged = { ...line(pid), ...patch };
    // Typing a stat implies they played.
    if (!('played' in patch)) merged.played = true;
    next.set(pid, merged);
    setLines(next);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const stats = [...lines.entries()]
      .filter(([, l]) => l.played)
      .map(([player_id, l]) => ({
        player_id,
        goals: l.goals,
        assists: l.assists,
        green_cards: l.green_cards,
        yellow_cards: l.yellow_cards,
        red_cards: l.red_cards,
        player_of_match: potm === player_id,
      }));
    const toInt = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.floor(Number(v))));
    const { error } = await requireSupabase().rpc('save_match_stats', {
      p_fixture_id: fixture.id,
      p_goals_for: toInt(score.for) as number,
      p_goals_against: toInt(score.against) as number,
      p_stats: stats,
      p_complete: complete,
    });
    if (error) {
      setNotices(errorLines(error).map((text) => ({ kind: 'error', text })));
      return;
    }
    setNotices([{ kind: 'success', text: 'Match stats saved.' }]);
    await queryClient.invalidateQueries();
  }

  async function remove() {
    if (!window.confirm('Delete this fixture and its stats?')) return;
    const { error } = await requireSupabase().from('fixtures').delete().eq('id', fixture.id);
    if (error) setNotices(errorLines(error).map((text) => ({ kind: 'error', text })));
    else {
      await queryClient.invalidateQueries({ queryKey: keys.fixtures });
      navigate('/manage/fixtures');
    }
  }

  return (
    <form onSubmit={(e) => void save(e)}>
      <h2>
        {sideById.get(fixture.side_id)?.name} {fixture.is_home ? 'v' : '@'} {fixture.opponent}
      </h2>
      <p className="muted">
        {formatDayTime(fixture.kickoff)} · {fixture.competition}{' '}
        {gw && `· ${gameweekLabel(gw, gameweeks.data ?? [])}`}
      </p>
      <Notices items={notices} />

      <section className="card">
        <h2>
          Score <small className="muted font-normal">(Felixstowe first)</small>
        </h2>
        <div className="flex items-center gap-2">
          <input
            className="input-inline w-20"
            type="number"
            min={0}
            aria-label="Felixstowe goals"
            value={score.for}
            onChange={(e) => setScore({ ...score, for: e.target.value })}
          />
          <span>-</span>
          <input
            className="input-inline w-20"
            type="number"
            min={0}
            aria-label="Opponent goals"
            value={score.against}
            onChange={(e) => setScore({ ...score, against: e.target.value })}
          />
        </div>
        <p className="muted mt-2 text-sm">
          {fixture.score_overridden
            ? "Entered by hand, so sync won't change it. Clear both boxes to let England Hockey set it again."
            : fixture.eh_fixture_id
              ? 'Comes from England Hockey. Editing it here stops sync overwriting it.'
              : ''}
        </p>
      </section>

      <section className="card">
        <h2>Who played</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Played</th>
              <th>Player</th>
              {STAT_LABELS.map((l) => (
                <th key={l}>{l}</th>
              ))}
              <th>PoM</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const l = line(p.id);
              return (
                <tr key={p.id} className={l.played ? 'bg-brand/10' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      aria-label={`${p.name} played`}
                      checked={l.played}
                      onChange={(e) => update(p.id, { played: e.target.checked })}
                    />
                  </td>
                  <td className="whitespace-nowrap">
                    <PosBadge position={p.position} /> {p.name}
                    {p.side_id !== fixture.side_id && (
                      <span className="muted"> ({sideById.get(p.side_id)?.short_name})</span>
                    )}
                  </td>
                  {STAT_FIELDS.map((field) => (
                    <td key={field}>
                      <input
                        className="input-inline w-14"
                        type="number"
                        min={0}
                        max={20}
                        aria-label={`${p.name} ${field.replace('_', ' ')}`}
                        value={l[field]}
                        onChange={(e) =>
                          update(p.id, { [field]: Math.max(0, Number(e.target.value) || 0) })
                        }
                      />
                    </td>
                  ))}
                  <td>
                    <input
                      type="radio"
                      name="potm"
                      className="h-5 w-5"
                      aria-label={`${p.name} player of the match`}
                      checked={potm === p.id}
                      onChange={() => {
                        setPotm(p.id);
                        if (!l.played) update(p.id, { played: true });
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {others.length > 0 && (
          <label className="field mt-3 max-w-md">
            Add a player from another side who played
            <select
              className="input"
              value=""
              onChange={(e) => {
                const pid = Number(e.target.value);
                if (pid) {
                  setExtra([...extra, pid]);
                  update(pid, { played: true });
                }
              }}
            >
              <option value="">Choose a player</option>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {sideById.get(p.side_id)?.short_name} · {p.name} ({p.position})
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={complete}
            onChange={(e) => setComplete(e.target.checked)}
          />{' '}
          Stats for this match are complete
        </label>
        <button className="btn mt-3">Save match</button>
      </section>
      {!fixture.eh_fixture_id && (
        <button type="button" className="btn btn-danger btn-sm" onClick={() => void remove()}>
          Delete fixture
        </button>
      )}
    </form>
  );
}
