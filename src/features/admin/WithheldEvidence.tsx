import { useQuery } from '@tanstack/react-query';
import { requireSupabase } from '@/lib/supabase';

export interface WithheldAppearance {
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
  /** Named teammates that day: the withheld player is whoever else was there. */
  teammates: string[];
}

/**
 * Every match a withheld player appeared in: date, side, opponent, score,
 * shirt worn, goals and cards. Enough to work out who they are.
 */
export function useWithheldAppearances(playerId: number | undefined) {
  return useQuery({
    queryKey: ['withheld-evidence', playerId ?? 0],
    enabled: Boolean(playerId),
    queryFn: async (): Promise<WithheldAppearance[]> => {
      const { data, error } = await requireSupabase()
        .from('performances')
        .select(
          'fixture_id, shirt, goals, green_cards, yellow_cards, red_cards, fixture:fixtures(kickoff, side_id, opponent, is_home, goals_for, goals_against)',
        )
        .eq('player_id', playerId as number);
      if (error) throw new Error(error.message);
      const rows = (data as unknown as Omit<WithheldAppearance, 'teammates'>[]).sort((a, b) =>
        (b.fixture?.kickoff ?? '').localeCompare(a.fixture?.kickoff ?? ''),
      );
      const { data: mates } = await requireSupabase()
        .from('performances')
        .select('fixture_id, player:players(name, name_withheld)')
        .in(
          'fixture_id',
          rows.map((r) => r.fixture_id),
        )
        .neq('player_id', playerId as number);
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
}
