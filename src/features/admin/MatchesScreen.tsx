import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loading, Notices, type Notice } from '@/components/ui';
import { formatShortDate, gameweekLabel } from '@/lib/format';
import { opponentName } from '@/lib/form';
import { matchChecks, matchesFilter, needsChecking, type MatchFilter } from '@/lib/managers';
import { keys, useFixtures, useGameweeks, useSides } from '@/lib/queries';
import { errorLines, requireSupabase } from '@/lib/supabase';
import { Chip, ChipRow, PageHead, Pill, SideTag, panel } from './adminUi';
import { useManagerStatus } from './status';

const FILTERS: [MatchFilter, string][] = [
  ['check', 'Needs checking'],
  ['withheld', 'Withheld'],
  ['locked', 'Locked'],
  ['upcoming', 'Upcoming'],
  ['all', 'All'],
];

export function MatchesScreen() {
  const status = useManagerStatus();
  const gameweeks = useGameweeks();
  const fixtures = useFixtures();
  const sides = useSides();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  if (status.loading || gameweeks.isLoading) return <Loading />;

  const filter = (params.get('filter') as MatchFilter | null) ?? 'check';
  const side = Number(params.get('side')) || null;
  const gw = Number(params.get('gw')) || null;
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const all = gameweeks.data ?? [];
  const sideById = new Map((sides.data ?? []).map((s) => [s.id, s]));
  const count = (f: MatchFilter) =>
    (fixtures.data ?? []).filter((x) => matchesFilter(x, status.evidenceFor(x.id), f)).length;
  // Newest first for played matches; soonest first for upcoming ones.
  const list = (fixtures.data ?? [])
    .filter(
      (f) =>
        matchesFilter(f, status.evidenceFor(f.id), filter) &&
        (!side || f.side_id === side) &&
        (!gw || f.gameweek_id === gw),
    )
    .sort((a, b) =>
      filter === 'upcoming'
        ? a.kickoff.localeCompare(b.kickoff)
        : b.kickoff.localeCompare(a.kickoff),
    );

  return (
    <>
      <PageHead title="Matches">
        <button
          type="button"
          className="min-h-tap rounded-full bg-surface px-4 font-display text-[15px] font-extrabold uppercase ring-1 ring-line lg:min-h-[40px]"
          onClick={() => setAdding(!adding)}
        >
          {adding ? 'Close' : 'Add a match by hand'}
        </button>
      </PageHead>

      {adding && <AddMatch />}

      <div className="mb-3 flex flex-col gap-2.5 lg:flex-row lg:flex-wrap lg:items-center">
        <div className="flex gap-2">
          <select
            aria-label="Gameweek"
            className="min-h-tap flex-1 rounded-[10px] border border-line bg-surface px-2.5 text-[15px] lg:min-h-[40px] lg:flex-none"
            value={gw ?? ''}
            onChange={(e) => set('gw', e.target.value || null)}
          >
            <option value="">All gameweeks</option>
            {all.map((g) => (
              <option key={g.id} value={g.id}>
                {gameweekLabel(g, all)}
              </option>
            ))}
          </select>
          <select
            aria-label="Side"
            className="min-h-tap flex-1 rounded-[10px] border border-line bg-surface px-2.5 text-[15px] lg:hidden"
            value={side ?? ''}
            onChange={(e) => set('side', e.target.value || null)}
          >
            <option value="">All sides</option>
            {(sides.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.short_name}
              </option>
            ))}
          </select>
        </div>
        <div className="hidden gap-2 lg:flex">
          <Chip on={!side} onClick={() => set('side', null)}>
            All
          </Chip>
          {(sides.data ?? []).map((s) => (
            <Chip key={s.id} on={side === s.id} onClick={() => set('side', String(s.id))}>
              {s.short_name}
            </Chip>
          ))}
        </div>
        <div className="hidden flex-1 lg:block" />
        <ChipRow>
          {FILTERS.map(([key, label]) => (
            <Chip key={key} on={filter === key} onClick={() => set('filter', key)}>
              {label}
              {key === 'check' || key === 'withheld' ? ` (${count(key)})` : ''}
            </Chip>
          ))}
        </ChipRow>
      </div>

      {/* Laptop: a table. */}
      <section className={`${panel} hidden overflow-hidden lg:block`}>
        <div className="grid grid-cols-[110px_54px_1fr_70px_minmax(0,320px)_90px] gap-3 border-b border-line px-[18px] py-3 text-xs font-bold uppercase tracking-wider text-ink-soft">
          <span>Date</span>
          <span>Side</span>
          <span>Opponent</span>
          <span className="text-right">Score</span>
          <span>Checks</span>
          <span />
        </div>
        {list.map((f) => {
          const needs = needsChecking(f);
          return (
            <div
              key={f.id}
              className={`grid min-h-[52px] grid-cols-[110px_54px_1fr_70px_minmax(0,320px)_90px] items-center gap-3 border-b border-line px-[18px] py-2.5 ${needs ? 'bg-[#fffaf3] dark:bg-[#2a2216]' : ''}`}
            >
              <span className="text-sm text-ink-soft">
                {formatShortDate(f.kickoff.slice(0, 10))}
              </span>
              <SideTag>{sideById.get(f.side_id)?.short_name}</SideTag>
              <span className="text-[15px] font-semibold">
                {opponentName(f.opponent)}{' '}
                <span className="text-[13px] font-bold text-ink-soft">{f.is_home ? 'H' : 'A'}</span>
              </span>
              <span className="text-right font-display text-xl font-extrabold">
                {f.goals_for === null ? 'v' : `${f.goals_for}-${f.goals_against}`}
              </span>
              <span className="flex flex-wrap gap-1.5">
                {matchChecks(f, status.evidenceFor(f.id)).map((c) => (
                  <Pill key={c.label} check={c} />
                ))}
              </span>
              <Link
                to={`/managers/matches/${f.id}`}
                className={`flex min-h-[34px] items-center justify-self-end rounded-full px-3 font-display text-sm font-extrabold uppercase no-underline hover:no-underline ${needs ? 'bg-brand text-white hover:bg-brand-dark' : 'bg-surface text-ink ring-1 ring-line'}`}
              >
                {needs ? 'Fix' : 'Open'}
              </Link>
            </div>
          );
        })}
      </section>

      {/* Phone: cards, each one a link. */}
      <div className="flex flex-col gap-3 lg:hidden">
        {list.map((f) => (
          <Link
            key={f.id}
            to={`/managers/matches/${f.id}`}
            className={`${panel} flex flex-col gap-2 border-l-4 px-3.5 py-3 text-ink no-underline hover:no-underline ${needsChecking(f) ? 'border-l-brand' : 'border-l-transparent'}`}
          >
            <span className="flex items-center gap-2.5">
              <SideTag>{sideById.get(f.side_id)?.short_name}</SideTag>
              <span className="flex-1">
                <span className="block text-[15px] font-bold">
                  {opponentName(f.opponent)}{' '}
                  <span className="text-ink-soft">({f.is_home ? 'H' : 'A'})</span>
                </span>
                <span className="muted block text-xs">
                  {formatShortDate(f.kickoff.slice(0, 10))}
                </span>
              </span>
              <span className="font-display text-2xl font-extrabold">
                {f.goals_for === null ? 'v' : `${f.goals_for}-${f.goals_against}`}
              </span>
              <span className="text-xl text-[#8a909b]" aria-hidden="true">
                ›
              </span>
            </span>
            <span className="flex flex-wrap gap-1.5">
              {matchChecks(f, status.evidenceFor(f.id)).map((c) => (
                <Pill key={c.label} check={c} />
              ))}
            </span>
          </Link>
        ))}
      </div>

      {!list.length && (
        <p className={`${panel} p-5 font-semibold`}>
          {filter === 'check' ? 'All caught up. No matches need checking.' : 'No matches.'}
        </p>
      )}
      <p className="muted mt-3 text-[13px]">
        Line-up comes from England Hockey, the sheet from Pitchero. Locked matches are never changed
        by a sync.
      </p>
    </>
  );
}

/** For cups, friendlies, or anything not on England Hockey. */
function AddMatch() {
  const sides = useSides();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [form, setForm] = useState({
    side_id: '',
    opponent: '',
    kickoff: '',
    is_home: 'true',
    competition: '',
  });

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
    navigate(`/managers/matches/${data}`);
  }

  const field = 'min-h-tap rounded-[10px] border border-line bg-surface px-2.5 text-base';
  return (
    <section className={`${panel} mb-4 p-4`}>
      <h2 className="mb-1 font-display text-xl font-extrabold uppercase">Add a match by hand</h2>
      <p className="muted mb-3 text-sm">
        For cups, friendlies, or anything not on England Hockey. UK time.
      </p>
      <Notices items={notices} />
      <form
        className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap"
        onSubmit={(e) => void add(e)}
      >
        <select
          className={field}
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
          className={field}
          placeholder="Opponent"
          required
          value={form.opponent}
          onChange={(e) => setForm({ ...form, opponent: e.target.value })}
        />
        <input
          className={field}
          type="datetime-local"
          aria-label="Push-back"
          required
          value={form.kickoff}
          onChange={(e) => setForm({ ...form, kickoff: e.target.value })}
        />
        <select
          className={field}
          aria-label="Home or away"
          value={form.is_home}
          onChange={(e) => setForm({ ...form, is_home: e.target.value })}
        >
          <option value="true">Home</option>
          <option value="false">Away</option>
        </select>
        <input
          className={field}
          placeholder="Competition (optional)"
          value={form.competition}
          onChange={(e) => setForm({ ...form, competition: e.target.value })}
        />
        <button className="btn">Add</button>
      </form>
    </section>
  );
}
