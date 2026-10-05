import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loading, Notices, type Notice } from '@/components/ui';
import { formatShortDate } from '@/lib/format';
import { opponentName } from '@/lib/form';
import type { NameSuggestion } from '@/lib/pitcheroMatch';
import { keys, usePlayers, useSides, type Player } from '@/lib/queries';
import { errorLines, requireSupabase } from '@/lib/supabase';
import { PageHead, SideTag, panel } from './adminUi';
import { useManagerStatus } from './status';
import { useWithheldAppearances, type WithheldAppearance } from './WithheldEvidence';

/** The shirt they wore, if it was the same every time. */
function shirtOf(apps: WithheldAppearance[]): string | null {
  const shirts = new Set(apps.map((a) => a.shirt).filter(Boolean));
  return shirts.size === 1 ? [...shirts][0]! : null;
}

function fit(s: NameSuggestion, all: NameSuggestion[]): { label: string; best: boolean } {
  const full = all.filter((x) => x.games === x.of);
  if (s.games === s.of && full.length === 1) return { label: 'Best fit', best: true };
  if (s.games === s.of) return { label: 'Possible', best: false };
  return { label: s.games * 2 >= s.of ? 'Possible' : 'Unlikely', best: false };
}

/**
 * Withheld players one at a time: their games, the Pitchero names they could
 * be, and a tap to say who it is. A queue alongside on a laptop.
 */
export function IdentifyScreen() {
  const status = useManagerStatus();
  const players = usePlayers();
  const sides = useSides();
  const [params, setParams] = useSearchParams();
  const [skipped, setSkipped] = useState<number[]>([]);
  if (status.loading || players.isLoading) return <Loading />;

  const sortOrder = new Map((sides.data ?? []).map((s) => [s.id, s.sort_order]));
  const queue = [...status.withheld].sort(
    (a, b) =>
      (sortOrder.get(a.side_id) ?? 0) - (sortOrder.get(b.side_id) ?? 0) ||
      a.name.localeCompare(b.name),
  );
  const wanted = Number(params.get('player')) || null;
  // Skipped players go to the back of the queue.
  const ordered = [
    ...queue.filter((p) => !skipped.includes(p.id)),
    ...queue.filter((p) => skipped.includes(p.id)),
  ];
  const current = ordered.find((p) => p.id === wanted) ?? ordered[0];
  const go = (p: Player | undefined) =>
    setParams(p ? { player: String(p.id) } : {}, { replace: true });
  const sideName = (id: number) => sides.data?.find((s) => s.id === id)?.short_name ?? '';

  if (!current) {
    return (
      <>
        <PageHead title="Identify players" />
        <p className={`${panel} p-5 font-semibold`}>Everyone has a name. Nothing to identify.</p>
      </>
    );
  }
  const position = queue.findIndex((p) => p.id === current.id) + 1;
  const after = () => ordered.find((p) => p.id !== current.id);

  return (
    <>
      <PageHead
        title="Identify players"
        sub={
          <>
            <span className="lg:hidden">
              {position} of {queue.length}
            </span>
            <span className="hidden lg:inline">
              {queue.length} players with a private England Hockey profile. Match each one to a real
              name once and every past and future game follows.
            </span>
          </>
        }
      />
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-line lg:hidden">
        <div className="h-full bg-brand" style={{ width: `${(position / queue.length) * 100}%` }} />
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
        <section className={`${panel} hidden overflow-hidden lg:block`}>
          <div className="border-b border-line px-4 py-3 text-xs font-bold uppercase tracking-wider text-ink-soft">
            Queue
          </div>
          {queue.map((p) => {
            const on = p.id === current.id;
            const top = status.nameSuggestions.get(p.id) ?? [];
            const likely = top.filter((s) => s.games === s.of).length;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => go(p)}
                className={`flex min-h-[56px] w-full items-center gap-2.5 border-b border-l-4 border-b-line px-4 py-1.5 text-left ${on ? 'border-l-brand bg-[#fff5f5] dark:bg-[#2e1a1c]' : 'border-l-transparent hover:bg-paper'}`}
              >
                <SideTag>{sideName(p.side_id)}</SideTag>
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{p.name}</span>
                <span
                  className={`text-xs font-bold ${likely === 1 ? 'text-[#1f7a4d] dark:text-[#5fd394]' : 'text-ink-soft'}`}
                >
                  {likely === 1
                    ? '1 likely'
                    : top.length
                      ? `${top.length} possible`
                      : 'No Pitchero'}
                </span>
              </button>
            );
          })}
        </section>

        <Candidate
          key={current.id}
          player={current}
          players={players.data ?? []}
          sideName={sideName}
          suggestions={status.nameSuggestions.get(current.id) ?? []}
          onDone={() => go(after())}
          onSkip={() => {
            setSkipped([...skipped.filter((id) => id !== current.id), current.id]);
            go(after());
          }}
        />
      </div>
    </>
  );
}

function Candidate({
  player,
  players,
  sideName,
  suggestions,
  onDone,
  onSkip,
}: {
  player: Player;
  players: Player[];
  sideName: (id: number) => string;
  suggestions: NameSuggestion[];
  onDone: () => void;
  onSkip: () => void;
}) {
  const queryClient = useQueryClient();
  const apps = useWithheldAppearances(player.id);
  const [choice, setChoice] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const rows = apps.data ?? [];
  const shirt = shirtOf(rows);
  const goals = rows.reduce((n, a) => n + a.goals, 0);
  const cards = rows.reduce((n, a) => n + a.green_cards + a.yellow_cards + a.red_cards, 0);
  const named = players
    .filter((p) => p.id !== player.id && !p.name_withheld)
    .sort((a, b) => a.name.localeCompare(b.name));
  const best = suggestions.find((s) => fit(s, suggestions).best);
  const picked = typed.trim() || choice || best?.name || null;

  async function finish(error: unknown) {
    setBusy(false);
    if (error) {
      setNotices(errorLines(error).map((text) => ({ kind: 'error', text })));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: keys.players });
    await queryClient.invalidateQueries({ queryKey: ['pitchero-evidence'] });
    await queryClient.invalidateQueries({ queryKey: ['fixture'] });
    onDone();
  }

  async function rename(name: string) {
    setBusy(true);
    // If they're already in the list (added by hand), merge instead.
    const existing = named.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (
        !window.confirm(
          `${existing.name} is already a player. Merge this one into them? Their stats move across.`,
        )
      ) {
        setBusy(false);
        return;
      }
      const { error } = await requireSupabase().rpc('merge_players', {
        p_from: player.id,
        p_into: existing.id,
      });
      await finish(error);
      return;
    }
    const { error } = await requireSupabase().from('players').update({ name }).eq('id', player.id);
    await finish(error);
  }

  return (
    <div className="flex flex-col gap-3.5">
      <section className={`${panel} flex flex-col gap-3 p-4 lg:p-5`}>
        <div className="flex items-center gap-3">
          <SideTag className="text-base">{sideName(player.side_id)}</SideTag>
          <div>
            <h2 className="m-0 font-display text-[22px] font-extrabold uppercase leading-none lg:text-[26px]">
              Withheld{shirt ? `, shirt ${shirt}` : ''}
            </h2>
            <p className="muted mt-1 text-xs lg:text-sm">
              {player.eh_member_id ? `England Hockey member ${player.eh_member_id} · ` : ''}
              {rows.length} {rows.length === 1 ? 'game' : 'games'}
              {goals ? ` · ${goals} ${goals === 1 ? 'goal' : 'goals'}` : ''}
              {cards ? ` · ${cards} ${cards === 1 ? 'card' : 'cards'}` : ''}
            </p>
          </div>
        </div>
        {apps.isLoading ? (
          <p className="muted text-sm">Loading their games...</p>
        ) : (
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-3 lg:gap-2.5">
            {rows.map((a) => {
              const f = a.fixture;
              const stats = [
                a.goals && `${a.goals} ${a.goals === 1 ? 'goal' : 'goals'}`,
                a.green_cards && 'green card',
                a.yellow_cards && 'yellow card',
                a.red_cards && 'red card',
              ]
                .filter(Boolean)
                .join(', ');
              const result =
                f && f.goals_for !== null && f.goals_against !== null
                  ? `${f.goals_for > f.goals_against ? 'won' : f.goals_for < f.goals_against ? 'lost' : 'drew'} ${f.goals_for}-${f.goals_against}`
                  : '';
              return (
                <div
                  key={a.fixture_id}
                  className="flex items-center justify-between gap-2 border-t border-line py-2 text-[13px] lg:flex-col lg:items-start lg:gap-1 lg:rounded-xl lg:border lg:border-[#e3e6eb] lg:p-3"
                >
                  <span>
                    <span className="block text-xs font-bold uppercase tracking-wider text-ink-soft">
                      {f ? formatShortDate(f.kickoff.slice(0, 10)) : ''}
                      {a.shirt ? ` · #${a.shirt}` : ''}
                    </span>
                    <span className="block text-sm font-bold lg:text-[15px]">
                      {f
                        ? `${sideName(f.side_id)} ${f.is_home ? 'v' : 'at'} ${opponentName(f.opponent)}`
                        : ''}
                    </span>
                    <span className="muted hidden lg:block">{result}</span>
                  </span>
                  <span className="whitespace-nowrap font-bold lg:font-normal lg:text-ink-soft">
                    {stats || 'Played'}
                  </span>
                  {a.teammates.length > 0 && (
                    <details className="hidden text-xs lg:block">
                      <summary className="cursor-pointer text-brand">
                        {a.teammates.length} named teammates
                      </summary>
                      <p className="mt-1">{a.teammates.join(', ')}</p>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className={`${panel} flex flex-col gap-2.5 p-4 lg:p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="m-0 font-display text-xl font-extrabold uppercase lg:text-[22px]">
            Who is it?
          </h2>
          <span className="muted text-xs lg:text-[13px]">
            {suggestions.length
              ? 'On the Pitchero sheet but not on England Hockey'
              : 'No Pitchero sheets to go on. Type their name below.'}
          </span>
        </div>
        <Notices items={notices} />
        {suggestions.slice(0, 6).map((s) => {
          const f = fit(s, suggestions);
          const on = picked === s.name && !typed.trim();
          return (
            <button
              key={s.name}
              type="button"
              disabled={busy}
              onClick={() => {
                setChoice(s.name);
                setTyped('');
              }}
              className={`flex min-h-[60px] items-center gap-3 rounded-xl px-3.5 py-2 text-left ${on ? 'bg-[#f2faf5] dark:bg-[#15291f] ring-2 ring-[#1f7a4d]' : 'bg-surface ring-1 ring-line hover:ring-ink'}`}
            >
              <span className="flex-1">
                <span className="block text-base font-bold">{s.name}</span>
                <span className="muted block text-xs lg:text-[13px]">
                  Missing from England Hockey in {s.games} of {s.of} games
                </span>
              </span>
              <span
                className={`text-xs font-bold lg:text-[13px] ${f.best ? 'text-[#1f7a4d] dark:text-[#5fd394]' : 'text-ink-soft'}`}
              >
                {f.label}
              </span>
            </button>
          );
        })}
        <div className="flex flex-col gap-2 border-t border-line pt-3 lg:flex-row">
          <input
            type="text"
            list="identify-named"
            placeholder="Someone else: type a name"
            aria-label="Someone else"
            className="min-h-[48px] flex-1 rounded-xl border border-line bg-surface px-3 text-base"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <datalist id="identify-named">
            {named.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
        </div>
        <div className="flex gap-2.5 pt-1 lg:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onSkip}
            className="min-h-[48px] flex-1 rounded-full bg-surface font-display text-base font-extrabold uppercase ring-1 ring-line lg:flex-none lg:px-6"
          >
            Skip
          </button>
          <button
            type="button"
            disabled={busy || !picked}
            onClick={() => picked && void rename(picked)}
            className="min-h-[48px] flex-[2] truncate rounded-full bg-[#1f7a4d] px-4 font-display text-base font-extrabold uppercase text-white disabled:opacity-50 lg:flex-none lg:px-6"
          >
            {busy ? 'Saving' : picked ? `This is ${picked.split(' ')[0]}` : 'Choose a name'}
          </button>
        </div>
        <p className="muted m-0 text-xs">
          Confirming keeps their England Hockey id, so the sync writes their goals and cards from
          now on. Typing someone already in the list merges the two.
        </p>
      </section>
    </div>
  );
}
