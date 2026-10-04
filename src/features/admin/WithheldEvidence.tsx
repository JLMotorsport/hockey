import { useQuery } from '@tanstack/react-query';
import { formatShortDate } from '@/lib/format';
import { requireSupabase } from '@/lib/supabase';

interface Appearance {
  fixture_id: number;
  shirt: string | null;
  goals: number;
  green_cards: number;
  yellow_cards: number;
  red_cards: number;
  fixture: {
    kickoff: string;
    side_id: number;
    opponent: string;
    is_home: boolean;
    goals_for: number | null;
    goals_against: number | null;
  } | null;
}

/**
 * Every match a withheld player appeared in: date, side, opponent, score,
 * shirt worn, goals and cards. Enough to work out who they are.
 */
export function WithheldEvidence({
  playerId,
  sideName,
}: {
  playerId: number;
  sideName: (sideId: number) => string;
}) {
  const appearances = useQuery({
    queryKey: ['withheld-evidence', playerId],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('performances')
        .select(
          'fixture_id, shirt, goals, green_cards, yellow_cards, red_cards, fixture:fixtures(kickoff, side_id, opponent, is_home, goals_for, goals_against)',
        )
        .eq('player_id', playerId);
      if (error) throw new Error(error.message);
      const rows = (data as unknown as Appearance[]).sort((a, b) =>
        (a.fixture?.kickoff ?? '').localeCompare(b.fixture?.kickoff ?? ''),
      );
      // Named teammates in the same matches: the withheld player is whoever
      // else was on the team sheet that day.
      const { data: mates } = await requireSupabase()
        .from('performances')
        .select('fixture_id, player:players(name, name_withheld)')
        .in(
          'fixture_id',
          rows.map((r) => r.fixture_id),
        )
        .neq('player_id', playerId);
      const teammates = new Map<number, string[]>();
      for (const m of (mates ?? []) as unknown as {
        fixture_id: number;
        player: { name: string; name_withheld: boolean } | null;
      }[]) {
        if (!m.player || m.player.name_withheld) continue;
        teammates.set(m.fixture_id, [...(teammates.get(m.fixture_id) ?? []), m.player.name]);
      }
      return rows.map((r) => ({ ...r, teammates: (teammates.get(r.fixture_id) ?? []).sort() }));
    },
  });

  if (appearances.isLoading) return <p className="muted text-sm">Loading matches...</p>;
  const rows = appearances.data ?? [];
  if (!rows.length) return <p className="muted text-sm">No matches recorded.</p>;

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="table text-xs">
        <thead>
          <tr>
            <th>Date</th>
            <th>Match</th>
            <th className="num">Score</th>
            <th className="num">Shirt</th>
            <th className="num">Goals</th>
            <th>Cards</th>
            <th>Named teammates</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a, i) => {
            const f = a.fixture;
            const cards = [
              ...Array<string>(a.green_cards).fill('🟩'),
              ...Array<string>(a.yellow_cards).fill('🟨'),
              ...Array<string>(a.red_cards).fill('🟥'),
            ];
            return (
              <tr key={i}>
                <td className="whitespace-nowrap">
                  {f ? formatShortDate(f.kickoff.slice(0, 10)) : ''}
                </td>
                <td className="whitespace-nowrap">
                  {f ? `${sideName(f.side_id)} ${f.is_home ? 'v' : '@'} ${f.opponent}` : ''}
                </td>
                <td className="num whitespace-nowrap">
                  {f && f.goals_for !== null ? `${f.goals_for}-${f.goals_against}` : ''}
                </td>
                <td className="num font-bold">{a.shirt ? `#${a.shirt}` : '?'}</td>
                <td className="num">{a.goals || ''}</td>
                <td
                  aria-label={`${a.green_cards} green, ${a.yellow_cards} yellow, ${a.red_cards} red`}
                >
                  {cards.join(' ')}
                </td>
                <td className="min-w-[14rem]">
                  <details>
                    <summary className="cursor-pointer text-brand">
                      {a.teammates.length} named
                    </summary>
                    <p className="mt-1 whitespace-normal">{a.teammates.join(', ')}</p>
                  </details>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
