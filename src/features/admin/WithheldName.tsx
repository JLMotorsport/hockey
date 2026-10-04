import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { keys, type Player } from '@/lib/queries';
import type { NameSuggestion } from '@/lib/pitcheroMatch';
import { errorLines, requireSupabase } from '@/lib/supabase';

/**
 * Correct a player whose name England Hockey withholds: type their real name,
 * or merge them into someone already in the list. Later syncs match them by
 * their England Hockey id, so this only needs doing once.
 */
export function WithheldName({
  player,
  players,
  onError,
  suggestions = [],
}: {
  player: Player;
  players: Player[];
  onError: (lines: string[]) => void;
  /** Names from Pitchero, best first. */
  suggestions?: NameSuggestion[];
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const others = players
    .filter((p) => p.id !== player.id && !p.name_withheld)
    .sort((a, b) => a.name.localeCompare(b.name));

  async function done(error: unknown) {
    setBusy(false);
    if (error) onError(errorLines(error));
    await queryClient.invalidateQueries({ queryKey: keys.players });
    await queryClient.invalidateQueries({ queryKey: ['fixture'] });
  }

  async function rename(to = name) {
    if (!to.trim()) return;
    setBusy(true);
    const { error } = await requireSupabase()
      .from('players')
      .update({ name: to.trim() })
      .eq('id', player.id);
    await done(error);
  }

  const top = suggestions[0];
  const certain =
    top && top.games === top.of && suggestions.filter((s) => s.games === s.of).length === 1;

  async function merge(intoId: number) {
    const into = others.find((p) => p.id === intoId);
    if (
      !into ||
      !window.confirm(`Merge ${player.name} into ${into.name}? Their stats move across.`)
    ) {
      return;
    }
    setBusy(true);
    const { error } = await requireSupabase().rpc('merge_players', {
      p_from: player.id,
      p_into: intoId,
    });
    await done(error);
  }

  return (
    <>
      {top && (
        <div className="mt-2 rounded-lg border border-line bg-paper px-3 py-2">
          <p className="text-sm">
            {certain ? (
              <>
                <strong>{top.name}</strong> is the only player on Pitchero&apos;s sheet that England
                Hockey doesn&apos;t account for, in all {top.of} of their games.
              </>
            ) : (
              <>Missing from England Hockey&apos;s sheet in their games. Tap who it is:</>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.slice(0, 6).map((s, i) => {
              const best = certain && i === 0;
              return (
                <button
                  key={s.name}
                  type="button"
                  disabled={busy}
                  onClick={() => void rename(s.name)}
                  className={`min-h-[40px] rounded-full px-3 text-sm font-semibold ${best ? 'bg-brand text-white' : 'bg-surface text-ink ring-1 ring-line hover:ring-brand'}`}
                >
                  {s.name}{' '}
                  <span className={best ? 'text-white/80' : 'muted'}>
                    {s.games}/{s.of}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <details className="mt-1 text-sm">
        <summary className="muted cursor-pointer">Someone else? Type a name or merge</summary>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[0.7rem] font-bold uppercase text-brand">
            Name withheld
          </span>
          <input
            className="input-inline w-36"
            placeholder="Real name"
            aria-label={`Real name for ${player.name}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void rename();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || !name.trim()}
            onClick={() => void rename()}
          >
            Save name
          </button>
          <select
            className="input-inline max-w-[11rem]"
            aria-label={`Or merge ${player.name} into an existing player`}
            value=""
            disabled={busy}
            onChange={(e) => void merge(Number(e.target.value))}
          >
            <option value="">or this is…</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </details>
    </>
  );
}
