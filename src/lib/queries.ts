import { useQuery } from '@tanstack/react-query';
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
  profile: (id: string) => ['profile', id] as const,
  adminUsers: ['admin-users'] as const,
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
    queryFn: async () =>
      unwrap(await requireSupabase().from('league_settings').select('*').eq('id', 1).single()),
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
