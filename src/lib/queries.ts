import { useQuery } from '@tanstack/react-query';
import { DEFAULT_FORMATIONS } from './formation';
import { requireSupabase } from './supabase';
import type { Position } from './scoring';
import type { Database } from '@/types/database';

type Tables = Database['public']['Tables'];
export type Side = Tables['sides']['Row'];
export type Gameweek = Tables['gameweeks']['Row'];
export type Settings = Tables['league_settings']['Row'];
export type Player = Omit<Tables['players']['Row'], 'position'> & { position: Position };
export type Fixture = Tables['fixtures']['Row'];
export type Performance = Tables['performances']['Row'];
export type LeagueRow = Database['public']['Functions']['league_table']['Returns'][number];
export type SquadRow = Database['public']['Functions']['squad_for']['Returns'][number];

/** A squad's score: the starting 11 after auto-subs (captain already doubled). */
export function squadTotal(rows: SquadRow[] | null | undefined): number {
  return (rows ?? []).reduce((sum, r) => sum + (r.counts ? r.points : 0), 0);
}

// Supabase returns errors rather than throwing; TanStack Query wants a throw.
function unwrap<T>(result: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  return result.data as NonNullable<T>;
}

export const keys = {
  sides: ['sides'] as const,
  players: ['players'] as const,
  gameweeks: ['gameweeks'] as const,
  settings: ['settings'] as const,
  fixtures: ['fixtures'] as const,
  fixture: (id: number) => ['fixture', id] as const,
  table: ['league-table'] as const,
  seasonPoints: ['season-points'] as const,
  squad: (userId: string, gameweekId: number) => ['squad', userId, gameweekId] as const,
  chips: (userId: string) => ['chips', userId] as const,
  profile: (id: string) => ['profile', id] as const,
  adminUsers: ['admin-users'] as const,
  priceTrend: ['price-trend'] as const,
  pricing: ['gameweek-pricing'] as const,
};

export function useSides() {
  return useQuery({
    queryKey: keys.sides,
    queryFn: async () =>
      unwrap(await requireSupabase().from('sides').select('*').order('sort_order').order('id')),
  });
}

export function usePlayers() {
  return useQuery({
    queryKey: keys.players,
    queryFn: async () =>
      unwrap(await requireSupabase().from('players').select('*').order('name')) as Player[],
  });
}

export function useGameweeks() {
  return useQuery({
    queryKey: keys.gameweeks,
    queryFn: async () =>
      unwrap(await requireSupabase().from('gameweeks').select('*').order('start_date')),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: async () => {
      const row = unwrap(
        await requireSupabase().from('league_settings').select('*').eq('id', 1).single(),
      );
      // Before migration 0005 is applied there is no formations column.
      return { ...row, formations: row.formations ?? DEFAULT_FORMATIONS };
    },
  });
}

export function useFixtures() {
  return useQuery({
    queryKey: keys.fixtures,
    queryFn: async () =>
      unwrap(await requireSupabase().from('fixtures').select('*').order('kickoff')),
  });
}

export function useFixtureDetail(id: number) {
  return useQuery({
    queryKey: keys.fixture(id),
    queryFn: async () => {
      const db = requireSupabase();
      const fixture = unwrap(await db.from('fixtures').select('*').eq('id', id).single());
      const performances = unwrap(await db.from('performances').select('*').eq('fixture_id', id));
      return { fixture, performances };
    },
  });
}

export function useLeagueTable() {
  return useQuery({
    queryKey: keys.table,
    queryFn: async () => unwrap(await requireSupabase().rpc('league_table')),
  });
}

export function useSeasonPoints() {
  return useQuery({
    queryKey: keys.seasonPoints,
    queryFn: async () => {
      const rows = unwrap(await requireSupabase().from('player_season_points').select('*'));
      return new Map(rows.map((r) => [r.player_id ?? 0, r.points ?? 0]));
    },
  });
}

export function useSquad(userId: string | undefined, gameweekId: number | undefined) {
  return useQuery({
    queryKey: keys.squad(userId ?? '', gameweekId ?? 0),
    enabled: Boolean(userId && gameweekId),
    queryFn: async () =>
      unwrap(
        await requireSupabase().rpc('squad_for', {
          p_user: userId as string,
          p_gameweek: gameweekId as number,
        }),
      ),
  });
}

/** Chips someone has played (others' only show once each deadline passes). */
export function useChips(userId: string | undefined) {
  return useQuery({
    queryKey: keys.chips(userId ?? ''),
    enabled: Boolean(userId),
    queryFn: async () =>
      unwrap(
        await requireSupabase()
          .from('chips_played')
          .select('chip, gameweek_id, side_id')
          .eq('user_id', userId as string),
      ),
  });
}

export function useProfile(id: string | undefined) {
  return useQuery({
    queryKey: keys.profile(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () =>
      unwrap(
        await requireSupabase()
          .from('profiles')
          .select('*')
          .eq('id', id as string)
          .single(),
      ),
  });
}

export function useAdminUsers() {
  return useQuery({
    queryKey: keys.adminUsers,
    queryFn: async () => unwrap(await requireSupabase().rpc('admin_users')),
  });
}

/** The gameweek that squad changes made now apply to. */
export function nextOpenGameweek(gameweeks: Gameweek[], now = new Date()): Gameweek | undefined {
  return gameweeks.find((g) => new Date(g.deadline) > now);
}

/** Gameweeks whose deadline has passed, oldest first. */
export function lockedGameweeks(gameweeks: Gameweek[], now = new Date()): Gameweek[] {
  return gameweeks.filter((g) => new Date(g.deadline) <= now);
}

/** Each player's latest weekly price change in tenths (+2 = up 0.2m). */
export function usePriceTrend() {
  return useQuery({
    queryKey: keys.priceTrend,
    queryFn: async () => {
      const rows = unwrap(await requireSupabase().from('player_price_trend').select('*'));
      return new Map(rows.map((r) => [r.player_id ?? 0, r.change ?? 0]));
    },
  });
}

/** Gameweeks whose weekly price changes are done; empty until prices are set. */
export function useGameweekPricing() {
  return useQuery({
    queryKey: keys.pricing,
    queryFn: async () => unwrap(await requireSupabase().from('gameweek_pricing').select('*')),
  });
}

/** Every player's points in one gameweek. */
export function useGameweekScores(gameweekId: number | undefined) {
  return useQuery({
    queryKey: ['gameweek-scores', gameweekId ?? 0],
    enabled: Boolean(gameweekId),
    queryFn: async () =>
      unwrap(
        await requireSupabase()
          .from('player_gameweek_points')
          .select('*')
          .eq('gameweek_id', gameweekId as number),
      ),
  });
}

/**
 * Every row of a query, a page at a time: the API returns at most 1,000 rows
 * per request, which the league passes partway through a season. The query
 * must have a stable order.
 */
async function fetchAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const size = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
}

/** Every player's points in every gameweek they played. */
export function useAllGameweekPoints() {
  return useQuery({
    queryKey: ['all-gameweek-points'],
    queryFn: async () =>
      (
        await fetchAll((from, to) =>
          requireSupabase()
            .from('player_gameweek_points')
            .select('player_id, gameweek_id, points')
            .order('gameweek_id')
            .order('player_id')
            .range(from, to),
        )
      ).map((r) => ({
        player_id: r.player_id ?? 0,
        gameweek_id: r.gameweek_id ?? 0,
        points: r.points ?? 0,
      })),
  });
}

/** Ids of gameweeks that have any points recorded. */
export function useScoredGameweeks() {
  const all = useAllGameweekPoints();
  return { ...all, data: all.data ? new Set(all.data.map((r) => r.gameweek_id)) : undefined };
}

/** Pitchero team sheets plus every England Hockey appearance, for suggestions. */
export function usePitcheroEvidence() {
  return useQuery({
    queryKey: ['pitchero-evidence'],
    queryFn: async () => {
      const db = requireSupabase();
      const sheets = await fetchAll((from, to) =>
        db
          .from('pitchero_lineups')
          .select('fixture_id, name, position')
          .order('fixture_id')
          .order('pitchero_player_id')
          .range(from, to),
      );
      const rows = (await fetchAll((from, to) =>
        db
          .from('performances')
          .select('fixture_id, player_id, player:players(name, name_withheld)')
          .order('id')
          .range(from, to),
      )) as unknown as {
        fixture_id: number;
        player_id: number;
        player: { name: string; name_withheld: boolean } | null;
      }[];
      const appearances = rows.flatMap((r) =>
        r.player
          ? [
              {
                fixture_id: r.fixture_id,
                player_id: r.player_id,
                name: r.player.name,
                name_withheld: r.player.name_withheld,
              },
            ]
          : [],
      );
      return { sheets, appearances };
    },
  });
}

export interface PlayerMatch {
  fixture_id: number;
  goals: number;
  assists: number;
  green_cards: number;
  yellow_cards: number;
  red_cards: number;
  player_of_match: boolean;
  fixture: {
    kickoff: string;
    gameweek_id: number;
    side_id: number;
    opponent: string;
    is_home: boolean;
    goals_for: number | null;
    goals_against: number | null;
  } | null;
}

/** Every match a player has a stat line for, oldest first. */
export function usePlayerHistory(playerId: number | undefined) {
  return useQuery({
    queryKey: ['player-history', playerId ?? 0],
    enabled: Boolean(playerId),
    queryFn: async () => {
      const rows = unwrap(
        await requireSupabase()
          .from('performances')
          .select(
            'fixture_id, goals, assists, green_cards, yellow_cards, red_cards, player_of_match, fixture:fixtures(kickoff, gameweek_id, side_id, opponent, is_home, goals_for, goals_against)',
          )
          .eq('player_id', playerId as number),
      ) as unknown as PlayerMatch[];
      return rows.sort((a, b) =>
        (a.fixture?.kickoff ?? '').localeCompare(b.fixture?.kickoff ?? ''),
      );
    },
  });
}
