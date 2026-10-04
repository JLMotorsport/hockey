// Integration tests against a local Supabase stack: they prove the database
// enforces the rules (the website only mirrors them).
//
//   npx supabase start
//   npx supabase db reset          # fresh database: these tests assume one
//   npm run test:integration
//
// Connection details come from `npx supabase status -o env` (see README).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTeamFeed } from '../../supabase/functions/_shared/ehFixtures.ts';
import { points, type StatLine } from '@/lib/scoring';
import type { Database } from '@/types/database';

const URL = process.env.SUPABASE_TEST_URL;
const ANON = process.env.SUPABASE_TEST_ANON_KEY;
const SERVICE = process.env.SUPABASE_TEST_SERVICE_ROLE;
const configured = Boolean(URL && ANON && SERVICE);

type Db = SupabaseClient<Database>;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = configured ? createClient<Database>(URL!, SERVICE!, opts) : (null as unknown as Db);
const anon = configured ? createClient<Database>(URL!, ANON!, opts) : (null as unknown as Db);

async function signUp(email: string, team: string): Promise<{ db: Db; id: string }> {
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: 'password123',
    email_confirm: true,
    user_metadata: { display_name: email.split('@')[0], team_name: team },
  });
  if (error) throw error;
  const db = createClient<Database>(URL!, ANON!, opts);
  const { error: signInError } = await db.auth.signInWithPassword({
    email,
    password: 'password123',
  });
  if (signInError) throw signInError;
  return { db, id: data.user.id };
}

function days(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString();
}

describe.skipIf(!configured)('league database', () => {
  let boss: { db: Db; id: string };
  let alice: { db: Db; id: string };
  let bob: { db: Db; id: string };
  let playerIds: number[] = [];
  let sides: Database['public']['Tables']['sides']['Row'][] = [];

  beforeAll(async () => {
    boss = await signUp('boss@example.com', 'Boss XI');
    alice = await signUp('alice@example.com', 'Alice XI');
    bob = await signUp('bob@example.com', 'Bob XI');
    sides = (await service.from('sides').select('*').order('sort_order')).data!;
  });

  it('makes the first account the manager and copies sign-up details', async () => {
    const { data } = await anon.from('profiles').select('*').order('created_at');
    expect(data!.map((p) => [p.team_name, p.is_admin])).toEqual([
      ['Boss XI', true],
      ['Alice XI', false],
      ['Bob XI', false],
    ]);
  });

  it('lets people rename their team but not make themselves a manager', async () => {
    await alice.db.from('profiles').update({ team_name: 'Alice Stars' }).eq('id', alice.id);
    const { error } = await alice.db.from('profiles').update({ is_admin: true }).eq('id', alice.id);
    expect(error).not.toBeNull();
    const { data } = await anon
      .from('profiles')
      .select('team_name, is_admin')
      .eq('id', alice.id)
      .single();
    expect(data).toEqual({ team_name: 'Alice Stars', is_admin: false });
  });

  it('only managers can change players, fixtures and settings', async () => {
    const row = { name: 'Sneaky', position: 'FWD', side_id: sides[0]!.id, price: 10 };
    expect((await alice.db.from('players').insert(row)).error).not.toBeNull();
    expect((await anon.from('players').insert(row)).error).not.toBeNull();
    const settings = await alice.db
      .from('league_settings')
      .update({ budget: 9999 })
      .eq('id', 1)
      .select();
    expect(settings.data ?? []).toEqual([]);
    expect((await alice.db.rpc('admin_users')).error?.message).toMatch(/managers only/i);
    expect(
      (await alice.db.rpc('set_admin', { p_user: alice.id, p_value: true })).error,
    ).not.toBeNull();
    expect((await boss.db.from('players').insert(row)).error).toBeNull();
    await boss.db.from('players').delete().eq('name', 'Sneaky');
  });

  it('keeps the England Hockey import for the server only', async () => {
    const res = await alice.db.rpc('import_fixtures', {
      p_side_id: sides[0]!.id,
      p_competition: 'x',
      p_rows: [],
    });
    expect(res.error).not.toBeNull();
  });

  it('imports the real Felixstowe 1 feed into Saturday gameweeks, idempotently', async () => {
    const feed: unknown = JSON.parse(
      readFileSync(join(__dirname, '../fixtures/eh-felixstowe-1-mens.json'), 'utf8'),
    );
    const { competition, rows } = parseTeamFeed(feed, 'felixstowe-1-mens');
    const m1 = sides[0]!;
    const first = await service.rpc('import_fixtures', {
      p_side_id: m1.id,
      p_competition: competition!,
      p_rows: rows as never,
    });
    expect(first.data).toEqual({ created: 6, updated: 0 });

    const peterborough = (
      await anon
        .from('fixtures')
        .select('*, gameweeks(*)')
        .eq('opponent', 'City Of Peterborough 2')
        .single()
    ).data!;
    expect(peterborough.goals_for).toBe(1);
    expect(peterborough.kickoff).toBe('2026-09-12T12:30:00+00:00'); // 13:30 BST
    expect(peterborough.gameweeks?.start_date).toBe('2026-09-12');
    expect(peterborough.gameweeks?.deadline).toBe('2026-09-12T09:00:00+00:00'); // 10:00 BST

    // A manager's corrected score survives the next sync.
    await boss.db.rpc('save_match_stats', {
      p_fixture_id: peterborough.id,
      p_goals_for: 2,
      p_goals_against: 4,
      p_stats: [],
      p_complete: false,
    });
    const again = await service.rpc('import_fixtures', {
      p_side_id: m1.id,
      p_competition: competition!,
      p_rows: rows as never,
    });
    expect(again.data).toEqual({ created: 0, updated: 6 });
    const after = (
      await anon
        .from('fixtures')
        .select('goals_for, score_overridden')
        .eq('id', peterborough.id)
        .single()
    ).data;
    expect(after).toEqual({ goals_for: 2, score_overridden: true });

    // Clearing the score hands it back to England Hockey.
    await boss.db.rpc('save_match_stats', {
      p_fixture_id: peterborough.id,
      p_goals_for: null as never,
      p_goals_against: null as never,
      p_stats: [],
      p_complete: false,
    });
    await service.rpc('import_fixtures', {
      p_side_id: m1.id,
      p_competition: competition!,
      p_rows: rows as never,
    });
    expect(
      (await anon.from('fixtures').select('goals_for').eq('id', peterborough.id).single()).data
        ?.goals_for,
    ).toBe(1);
  });

  it('matches the website scoring for every kind of stat line', async () => {
    const lines: StatLine[] = [
      {
        position: 'DEF',
        goals: 1,
        assists: 0,
        green_cards: 0,
        yellow_cards: 0,
        red_cards: 0,
        player_of_match: false,
        goals_for: 2,
        goals_against: 0,
      },
      {
        position: 'GK',
        goals: 0,
        assists: 0,
        green_cards: 1,
        yellow_cards: 1,
        red_cards: 0,
        player_of_match: false,
        goals_for: 0,
        goals_against: 7,
      },
      {
        position: 'MID',
        goals: 2,
        assists: 3,
        green_cards: 0,
        yellow_cards: 0,
        red_cards: 1,
        player_of_match: true,
        goals_for: 3,
        goals_against: 0,
      },
      {
        position: 'FWD',
        goals: 3,
        assists: 1,
        green_cards: 0,
        yellow_cards: 0,
        red_cards: 0,
        player_of_match: true,
        goals_for: null,
        goals_against: null,
      },
    ];
    for (const l of lines) {
      const { data } = await anon.rpc('performance_points', {
        p_position: l.position,
        p_goals: l.goals,
        p_assists: l.assists,
        p_green: l.green_cards,
        p_yellow: l.yellow_cards,
        p_red: l.red_cards,
        p_player_of_match: l.player_of_match,
        p_goals_for: l.goals_for as number,
        p_goals_against: l.goals_against as number,
      });
      expect(data).toBe(points(l));
    }
  });

  describe('squads', () => {
    let lockedGw: number;
    let openGw: number;
    let laterGw: number;
    let fixtureId: number;

    beforeAll(async () => {
      // Upcoming fixtures make upcoming gameweeks.
      const m2 = sides[1]!.id;
      for (const [n, opp] of [
        [10, 'Open Opp'],
        [17, 'Later Opp'],
      ] as const) {
        await service
          .from('fixtures')
          .insert({ side_id: m2, kickoff: days(n), opponent: opp, gameweek_id: 0 });
      }
      const gws = (
        await anon
          .from('gameweeks')
          .select('*')
          .gt('deadline', new Date().toISOString())
          .order('start_date')
      ).data!;
      openGw = gws[0]!.id;
      laterGw = gws[1]!.id;

      const shape = [
        'GK',
        'DEF',
        'DEF',
        'DEF',
        'DEF',
        'MID',
        'MID',
        'MID',
        'MID',
        'FWD',
        'FWD',
        'GK',
        'FWD',
        'DEF',
      ];
      const rows = shape.map((position, i) => ({
        name: `Player ${i}`,
        position,
        side_id: sides[i % 7]!.id,
        price: 60,
      }));
      playerIds = (await boss.db.from('players').insert(rows).select('id').order('id')).data!.map(
        (p) => p.id,
      );
    });

    const xi = () => playerIds.slice(0, 11);

    it('saves a valid squad for the next open gameweek', async () => {
      const { data, error } = await alice.db.rpc('save_squad', {
        p_player_ids: xi(),
        p_captain_id: xi()[9]!,
      });
      expect(error).toBeNull();
      expect(data).toBe(openGw);
      const { data: squad } = await alice.db.rpc('squad_for', {
        p_user: alice.id,
        p_gameweek: laterGw,
      });
      expect(squad).toHaveLength(11); // carries forward
    });

    it('rejects broken squads with one message per problem', async () => {
      const tooFew = await bob.db.rpc('save_squad', {
        p_player_ids: xi().slice(0, 10),
        p_captain_id: 0,
      });
      const lines = tooFew.error!.message.split('\n');
      expect(lines).toContain('Pick exactly 11 players (you have 10).');
      expect(lines).toContain('Choose a captain from your squad.');

      const twoKeepers = [...xi().slice(0, 10), playerIds[11]!];
      const res = await bob.db.rpc('save_squad', {
        p_player_ids: twoKeepers,
        p_captain_id: twoKeepers[0]!,
      });
      expect(res.error!.message).toMatch(/exactly 1 goalkeeper/);

      await boss.db.from('league_settings').update({ max_per_side: 1 }).eq('id', 1);
      const perSide = await bob.db.rpc('save_squad', {
        p_player_ids: xi(),
        p_captain_id: xi()[0]!,
      });
      expect(perSide.error!.message).toMatch(/Max 1 players from/);
      await boss.db.from('league_settings').update({ max_per_side: 4 }).eq('id', 1);
    });

    it('hides squads from others until the deadline', async () => {
      const peek = await bob.db.rpc('squad_for', { p_user: alice.id, p_gameweek: openGw });
      expect(peek.error!.message).toMatch(/hidden until the deadline/);
      const { data } = await bob.db.from('picks').select('*').eq('user_id', alice.id);
      expect(data).toEqual([]);
    });

    it('limits transfers once the first squad has locked', async () => {
      // Lock the gameweek Alice picked for, as if Saturday 10:00 has passed.
      lockedGw = openGw;
      await service
        .from('gameweeks')
        .update({ deadline: days(-1) })
        .eq('id', lockedGw);

      const three = [playerIds[11]!, ...xi().slice(1, 9), playerIds[12]!, playerIds[13]!];
      const res = await alice.db.rpc('save_squad', {
        p_player_ids: three,
        p_captain_id: three[1]!,
      });
      expect(res.error!.message).toMatch(/3 transfers; only 2 allowed/);

      const two = [playerIds[11]!, ...xi().slice(1, 10), playerIds[12]!];
      const ok = await alice.db.rpc('save_squad', { p_player_ids: two, p_captain_id: two[1]! });
      expect(ok.error).toBeNull();
      expect(ok.data).toBe(laterGw);
      // Saving again before the same deadline doesn't use more transfers.
      expect(
        (await alice.db.rpc('save_squad', { p_player_ids: two, p_captain_id: two[2]! })).error,
      ).toBeNull();
    });

    it('reveals locked squads and scores them, captain doubled', async () => {
      const visible = await bob.db.rpc('squad_for', { p_user: alice.id, p_gameweek: lockedGw });
      expect(visible.error).toBeNull();

      // A result in the locked gameweek, with the captain (a forward) scoring twice.
      const striker = xi()[9]!;
      const lockedStart = (
        await anon.from('gameweeks').select('start_date').eq('id', lockedGw).single()
      ).data!.start_date;
      fixtureId = (
        await service
          .from('fixtures')
          .insert({
            side_id: sides[2]!.id,
            kickoff: `${lockedStart}T14:00:00+01:00`,
            opponent: 'Rivals',
            gameweek_id: 0,
          })
          .select('id')
          .single()
      ).data!.id;
      const saved = await boss.db.rpc('save_match_stats', {
        p_fixture_id: fixtureId,
        p_goals_for: 3,
        p_goals_against: 1,
        p_stats: [
          { player_id: striker, goals: 2 },
          { player_id: xi()[0]!, goals: 0 },
        ],
        p_complete: true,
      });
      expect(saved.error).toBeNull();

      const strikerPoints = 1 + 2 * 4 + 2; // played, 2 goals, win
      const keeperPoints = 1 + 2; // played, win (1 conceded loses nothing)
      const { data: table } = await anon.rpc('league_table');
      const aliceRow = table!.find((r) => r.user_id === alice.id)!;
      expect(aliceRow.total).toBe(strikerPoints * 2 + keeperPoints);
      expect(aliceRow.rank).toBe(1);
      expect(table!.find((r) => r.user_id === bob.id)!.total).toBe(0);

      // Unticking a player removes their stat line.
      await boss.db.rpc('save_match_stats', {
        p_fixture_id: fixtureId,
        p_goals_for: 3,
        p_goals_against: 1,
        p_stats: [{ player_id: striker, goals: 2 }],
        p_complete: true,
      });
      const { data: perfs } = await anon
        .from('performances')
        .select('player_id')
        .eq('fixture_id', fixtureId);
      expect(perfs!.map((p) => p.player_id)).toEqual([striker]);
    });

    it('refuses to save when every gameweek has locked', async () => {
      await service
        .from('gameweeks')
        .update({ deadline: days(-1) })
        .gt('deadline', new Date().toISOString());
      const res = await bob.db.rpc('save_squad', { p_player_ids: xi(), p_captain_id: xi()[0]! });
      expect(res.error!.message).toMatch(/no upcoming gameweek/);
    });
  });

  it('manual fixtures and deadlines use UK time', async () => {
    const { data: id } = await boss.db.rpc('add_fixture', {
      p_side_id: sides[4]!.id,
      p_opponent: 'Ipswich',
      p_kickoff: '2026-12-27T11:00',
      p_is_home: true,
      p_competition: '',
    });
    const f = (await anon.from('fixtures').select('*, gameweeks(*)').eq('id', id!).single()).data!;
    expect(f.kickoff).toBe('2026-12-27T11:00:00+00:00');
    expect(f.competition).toBe('Friendly / cup');
    expect(f.gameweeks?.start_date).toBe('2026-12-26'); // Sunday belongs to that Saturday's week

    await boss.db.rpc('set_deadline', {
      p_gameweek_id: f.gameweek_id,
      p_deadline: '2026-12-26T09:30',
    });
    const gw = (await anon.from('gameweeks').select('deadline').eq('id', f.gameweek_id).single())
      .data!;
    expect(gw.deadline).toBe('2026-12-26T09:30:00+00:00');
    expect(
      (
        await alice.db.rpc('add_fixture', {
          p_side_id: sides[4]!.id,
          p_opponent: 'X',
          p_kickoff: '2026-12-27T11:00',
          p_is_home: true,
          p_competition: '',
        })
      ).error,
    ).not.toBeNull();
  });

  it('imports England Hockey line-ups: links, creates, scores and respects manual edits', async () => {
    const w2 = sides[5]!.id;
    const fixtureId = (
      await service
        .from('fixtures')
        .insert({
          side_id: w2,
          kickoff: '2026-10-03T12:00:00+01:00',
          opponent: 'Lineup Opp',
          gameweek_id: 0,
          goals_for: 3,
          goals_against: 0,
          eh_fixture_id: 'eh-lineup-1',
        })
        .select('id')
        .single()
    ).data!.id;
    await boss.db
      .from('players')
      .insert({ name: 'Linked Name', position: 'DEF', side_id: w2, price: 70 });

    const lineup = [
      {
        member_id: 'm-linked',
        name: 'linked name',
        is_gk: false,
        goals: 2,
        green_cards: 0,
        yellow_cards: 1,
        red_cards: 0,
      },
      {
        member_id: 'm-keeper',
        name: 'New Keeper',
        is_gk: true,
        goals: 0,
        green_cards: 0,
        yellow_cards: 0,
        red_cards: 0,
      },
    ];
    expect(
      (await alice.db.rpc('import_lineup', { p_fixture_id: fixtureId, p_players: lineup as never }))
        .error,
    ).not.toBeNull();

    const first = await service.rpc('import_lineup', {
      p_fixture_id: fixtureId,
      p_players: lineup as never,
    });
    expect(first.data).toEqual({ created: 1, players: 2 });
    const linked = (await anon.from('players').select('*').eq('name', 'Linked Name').single())
      .data!;
    expect(linked).toMatchObject({
      eh_member_id: 'm-linked',
      active: true,
      needs_review: false,
      price: 70,
    });
    const keeper = (await anon.from('players').select('*').eq('eh_member_id', 'm-keeper').single())
      .data!;
    expect(keeper).toMatchObject({
      position: 'GK',
      active: false,
      needs_review: true,
      side_id: w2,
    });

    const perfs = (
      await anon
        .from('performances')
        .select('player_id, goals, yellow_cards')
        .eq('fixture_id', fixtureId)
    ).data!;
    expect(perfs.find((p) => p.player_id === linked.id)).toMatchObject({
      goals: 2,
      yellow_cards: 1,
    });
    expect(
      (
        await anon
          .from('fixtures')
          .select('stats_complete, lineup_imported_at')
          .eq('id', fixtureId)
          .single()
      ).data,
    ).toMatchObject({ stats_complete: true });

    // Re-running is harmless, and an empty line-up changes nothing.
    expect(
      (await service.rpc('import_lineup', { p_fixture_id: fixtureId, p_players: lineup as never }))
        .data,
    ).toEqual({ created: 0, players: 2 });
    await service.rpc('import_lineup', { p_fixture_id: fixtureId, p_players: [] as never });
    expect(
      (await anon.from('performances').select('id').eq('fixture_id', fixtureId)).data,
    ).toHaveLength(2);

    // A manager's edit (e.g. adding player of the match) takes the match off the sync.
    await boss.db.rpc('save_match_stats', {
      p_fixture_id: fixtureId,
      p_goals_for: 3,
      p_goals_against: 0,
      p_stats: [{ player_id: linked.id, goals: 2, yellow_cards: 1, player_of_match: true }],
      p_complete: true,
    });
    expect(
      (await service.rpc('import_lineup', { p_fixture_id: fixtureId, p_players: lineup as never }))
        .data,
    ).toEqual({ skipped: true });
    expect(
      (await anon.from('performances').select('id').eq('fixture_id', fixtureId)).data,
    ).toHaveLength(1);

    // Handing it back is manager-only.
    expect((await alice.db.rpc('use_eh_stats', { p_fixture_id: fixtureId })).error).not.toBeNull();
    await boss.db.rpc('use_eh_stats', { p_fixture_id: fixtureId });
    expect(
      (await service.rpc('import_lineup', { p_fixture_id: fixtureId, p_players: lineup as never }))
        .data,
    ).toEqual({ created: 0, players: 2 });
  });
});
