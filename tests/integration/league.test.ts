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
        is_home: true,
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
        is_home: false,
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
        is_home: false,
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
        is_home: true,
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
        p_is_home: l.is_home,
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
        // The bench: sub keeper, then outfield subs.
        'GK',
        'DEF',
        'MID',
        'FWD',
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
    const subs = () => playerIds.slice(14, 18);
    const save = (
      who: { db: Db },
      starters: number[],
      captain: number,
      bench = subs(),
      vice = starters.find((id) => id !== captain) ?? 0,
    ) =>
      who.db.rpc('save_squad', {
        p_starters: starters,
        p_bench: bench,
        p_captain_id: captain,
        p_vice_id: vice,
      });

    it('saves a valid squad for the next open gameweek', async () => {
      const { data, error } = await save(alice, xi(), xi()[9]!);
      expect(error).toBeNull();
      expect(data).toBe(openGw);
      const { data: squad } = await alice.db.rpc('squad_for', {
        p_user: alice.id,
        p_gameweek: laterGw,
      });
      expect(squad).toHaveLength(15); // carries forward
      expect(squad!.filter((r) => r.bench_order !== null).map((r) => r.player_id)).toEqual(subs());
    });

    it('rejects broken squads with one message per problem', async () => {
      const tooFew = await save(bob, xi().slice(0, 10), 0);
      const lines = tooFew.error!.message.split('\n');
      expect(lines).toContain('Pick 11 starters (you have 10).');
      expect(lines).toContain('Choose a captain from your starting 11.');
      expect((await save(bob, xi(), xi()[0]!, subs(), xi()[0]!)).error!.message).toBe(
        'Choose a vice-captain from your starting 11 (not the captain).',
      );

      const badBench = await save(bob, xi(), xi()[0]!, [
        subs()[1]!,
        subs()[0]!,
        ...subs().slice(2),
      ]);
      const benchLines = badBench.error!.message.split('\n');
      expect(benchLines).toContain('The first sub must be a goalkeeper.');
      expect(benchLines).toContain('Subs 1 to 3 must be outfield players.');
      expect((await save(bob, xi(), xi()[0]!, subs().slice(0, 3))).error!.message).toMatch(
        /Pick 4 subs \(you have 3\)/,
      );
      expect((await save(bob, xi(), subs()[2]!)).error!.message).toMatch(/captain/);
      expect(
        (await save(bob, xi(), xi()[0]!, [...subs().slice(0, 3), xi()[5]!])).error!.message,
      ).toMatch(/only be picked once/);

      const twoKeepers = [...xi().slice(0, 10), playerIds[11]!];
      // (playerIds[11] is a second keeper)
      const res = await save(bob, twoKeepers, twoKeepers[0]!);
      expect(res.error!.message).toMatch(/exactly 1 goalkeeper/);

      await boss.db.from('league_settings').update({ max_per_side: 1 }).eq('id', 1);
      const perSide = await save(bob, xi(), xi()[0]!);
      expect(perSide.error!.message).toMatch(/Max 1 players from/);
      await boss.db.from('league_settings').update({ max_per_side: 4 }).eq('id', 1);
    });

    it('only accepts the league formations', async () => {
      const ids = (idx: number[]) => idx.map((i) => playerIds[i]!);
      // 0 GK, 1-4 DEF, 5-8 MID, 9-10 FWD, 11 GK, 12 FWD, 13 DEF
      const fourFourTwo = ids([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      // Same 15 (2 GK, 5 DEF, 5 MID, 3 FWD), lined up differently.
      const threeFourThree = ids([0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 17]);
      const threeFourThreeBench = ids([14, 4, 15, 16]);
      const fourThreeThree = ids([0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 17]);
      const fourThreeThreeBench = ids([14, 15, 8, 16]);
      expect((await save(bob, fourFourTwo, fourFourTwo[0]!)).error).toBeNull();

      await boss.db
        .from('league_settings')
        .update({ formations: ['3-4-3'] })
        .eq('id', 1);
      // A saved 4-4-2 can still change captain after 4-4-2 is switched off.
      expect((await save(bob, fourFourTwo, fourFourTwo[1]!)).error).toBeNull();
      expect(
        (await save(bob, threeFourThree, threeFourThree[0]!, threeFourThreeBench)).error,
      ).toBeNull();
      const res = await save(bob, fourThreeThree, fourThreeThree[0]!, fourThreeThreeBench);
      expect(res.error!.message).toBe("That's a 4-3-3. Pick one of: 3-4-3.");

      await boss.db
        .from('league_settings')
        .update({ formations: ['4-4-2', '4-3-3', '3-4-3', '3-5-2', '5-3-2', '4-5-1', '5-4-1'] })
        .eq('id', 1);
      // Leave Bob without a squad; later tests expect him on zero.
      await service.from('picks').delete().eq('user_id', bob.id);
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
      const res = await save(alice, three, three[1]!);
      expect(res.error!.message).toMatch(/3 transfers; only 2 allowed/);

      const two = [playerIds[11]!, ...xi().slice(1, 10), playerIds[12]!];
      const ok = await save(alice, two, two[1]!);
      expect(ok.error).toBeNull();
      expect(ok.data).toBe(laterGw);
      // Saving again before the same deadline doesn't use more transfers.
      expect((await save(alice, two, two[2]!)).error).toBeNull();
    });

    it("keeps a bank: selling at today's price funds buys", async () => {
      // First squad: 11 players at 6.0m from a 100.0m budget.
      const first = (
        await alice.db
          .from('squad_banks')
          .select('bank')
          .eq('user_id', alice.id)
          .eq('gameweek_id', lockedGw)
          .single()
      ).data;
      expect(first?.bank).toBe(1000 - 15 * 60);
      expect(
        (
          await bob.db
            .from('squad_banks')
            .select('bank')
            .eq('user_id', alice.id)
            .eq('gameweek_id', laterGw)
        ).data,
      ).toEqual([]);

      // One of Alice's original players shoots up to 30.0m.
      const riser = xi()[3]!;
      await service.from('players').update({ price: 300 }).eq('id', riser);
      await boss.db.from('league_settings').update({ transfers_per_gameweek: 5 }).eq('id', 1);
      expect((await alice.db.rpc('bank_before_next')).data).toBe(100);

      // Sell him (plus the two already swapped this week) and buy three 6.0m players.
      const squad = [
        playerIds[11]!,
        ...xi().slice(1, 3),
        playerIds[13]!,
        ...xi().slice(4, 10),
        playerIds[12]!,
      ];
      expect((await save(alice, squad, squad[1]!)).error).toBeNull();
      const bank = (
        await alice.db
          .from('squad_banks')
          .select('bank')
          .eq('user_id', alice.id)
          .eq('gameweek_id', laterGw)
          .single()
      ).data!.bank;
      expect(bank).toBe(100 + 60 + 60 + 300 - 60 - 60 - 60);

      // A buy beyond the bank plus sales is refused: player 13 now costs 50.0m.
      await service.from('players').update({ price: 500 }).eq('id', playerIds[13]!);
      // Re-saving the same squad is fine: the bank is worked out from the
      // squad Alice started the week with, so nothing is bought twice...
      await service.from('players').update({ price: 60 }).eq('id', riser);
      const res = await save(alice, squad, squad[2]!);
      // ...but with the riser back at 6.0m, selling him no longer covers a 50.0m buy.
      expect(res.error!.message).toMatch(/more than you can spend/);
      await service.from('players').update({ price: 60 }).eq('id', playerIds[13]!);

      await service.from('players').update({ price: 60 }).eq('id', riser);
      await boss.db.from('league_settings').update({ transfers_per_gameweek: 2 }).eq('id', 1);
      // Put Alice back on the squad the next tests expect.
      const two = [playerIds[11]!, ...xi().slice(1, 10), playerIds[12]!];
      expect((await save(alice, two, two[1]!)).error).toBeNull();
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

      const strikerPoints = 1 + 2 * 4 + 1; // played, 2 goals, home win
      const keeperPoints = 1 + 1; // played, home win (1 conceded loses nothing)
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

    it('brings subs on for starters who did not play, once the weekend is over', async () => {
      // A gameweek two weeks ago, picked directly for Bob.
      const past = (
        await service
          .from('fixtures')
          .insert({
            side_id: sides[3]!.id,
            kickoff: days(-14),
            opponent: 'Old Opp',
            gameweek_id: 0,
          })
          .select('id, gameweek_id')
          .single()
      ).data!;
      const [gk, def1] = [xi()[0]!, xi()[1]!];
      const captain = xi()[9]!; // a forward
      const vice = xi()[10]!;
      const [subGk, subDef, subMid, subFwd] = subs() as [number, number, number, number];
      await service.from('picks').insert([
        ...xi().map((id) => ({
          user_id: bob.id,
          gameweek_id: past.gameweek_id,
          player_id: id,
          is_captain: id === captain,
          is_vice: id === vice,
          bench_order: null,
        })),
        ...subs().map((id, i) => ({
          user_id: bob.id,
          gameweek_id: past.gameweek_id,
          player_id: id,
          is_captain: false,
          is_vice: false,
          bench_order: i + 1,
        })),
      ]);
      // Everyone played except the keeper, a defender, the captain and sub 1.
      const played = [...xi(), ...subs()].filter((id) => ![gk, def1, captain, subDef].includes(id));
      expect(
        (
          await boss.db.rpc('save_match_stats', {
            p_fixture_id: past.id,
            p_goals_for: 1,
            p_goals_against: 0,
            p_stats: played.map((id) => ({ player_id: id, goals: id === subFwd ? 1 : 0 })),
            p_complete: true,
          })
        ).error,
      ).toBeNull();

      const lineup = async () => {
        const { data, error } = await bob.db.rpc('squad_for', {
          p_user: bob.id,
          p_gameweek: past.gameweek_id,
        });
        expect(error).toBeNull();
        return new Map(data!.map((r) => [r.player_id, r]));
      };
      let rows = await lineup();
      // Keeper for keeper; the defender by sub 2 (sub 1 didn't play), as a
      // 3-5-2 is allowed; the captain by sub 3.
      expect(rows.get(gk)).toMatchObject({ counts: false, sub: 'off' });
      expect(rows.get(subGk)).toMatchObject({ counts: true, sub: 'on' });
      expect(rows.get(def1)).toMatchObject({ counts: false, sub: 'off' });
      expect(rows.get(subDef)).toMatchObject({ counts: false, sub: null });
      expect(rows.get(subMid)).toMatchObject({ counts: true, sub: 'on' });
      expect(rows.get(captain)).toMatchObject({ counts: false, sub: 'off', points: 0 });
      expect(rows.get(subFwd)).toMatchObject({ counts: true, sub: 'on' });
      expect([...rows.values()].filter((r) => r.counts)).toHaveLength(11);
      // Points as scored, plus the vice's again (below).
      const pts = (
        await anon
          .from('player_gameweek_points')
          .select('player_id, points')
          .eq('gameweek_id', past.gameweek_id)
      ).data!;
      const expected = pts
        .filter((p) => [...rows.values()].some((r) => r.player_id === p.player_id && r.counts))
        .reduce((sum, p) => sum + p.points!, 0);
      const counted = [...rows.values()].filter((r) => r.counts).reduce((s, r) => s + r.points, 0);
      // The captain didn't play, so the vice's points are doubled instead.
      const vicePoints = pts.find((p) => p.player_id === vice)!.points!;
      expect(rows.get(vice)).toMatchObject({ doubled: true, points: vicePoints * 2 });
      expect(counted).toBe(expected + vicePoints);

      // Only 4-4-2 allowed: no sub can replace the defender and keep a 4-4-2,
      // so he stays in (on 0); the forward still comes on for the captain.
      await boss.db
        .from('league_settings')
        .update({ formations: ['4-4-2'] })
        .eq('id', 1);
      rows = await lineup();
      expect(rows.get(def1)).toMatchObject({ counts: true, sub: null, points: 0 });
      expect(rows.get(subMid)).toMatchObject({ counts: false, sub: null });
      expect(rows.get(subFwd)).toMatchObject({ counts: true, sub: 'on' });
      await boss.db
        .from('league_settings')
        .update({ formations: ['4-4-2', '4-3-3', '3-4-3', '3-5-2', '5-3-2', '4-5-1', '5-4-1'] })
        .eq('id', 1);

      // Tidy up so later tests see the league as before.
      await service.from('picks').delete().eq('user_id', bob.id);
      await service.from('fixtures').delete().eq('id', past.id);
      await service.from('gameweeks').delete().eq('id', past.gameweek_id);
    });

    it('refuses to save when every gameweek has locked', async () => {
      await service
        .from('gameweeks')
        .update({ deadline: days(-1) })
        .gt('deadline', new Date().toISOString());
      const res = await save(bob, xi(), xi()[0]!);
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

  it('imports England Hockey line-ups alongside manual entries for withheld players', async () => {
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
    const added = (
      await boss.db
        .from('players')
        .insert([
          { name: 'Linked Name', position: 'DEF', side_id: w2, price: 70 },
          { name: 'Withheld Wendy', position: 'FWD', side_id: w2, price: 60 },
        ])
        .select('id, name')
    ).data!;
    const wendy = added.find((p) => p.name === 'Withheld Wendy')!.id;

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
    const run = (players: unknown[], withheld = 1) =>
      service.rpc('import_lineup', {
        p_fixture_id: fixtureId,
        p_players: players as never,
        p_withheld: withheld,
      });
    expect(
      (
        await alice.db.rpc('import_lineup', {
          p_fixture_id: fixtureId,
          p_players: lineup as never,
          p_withheld: 0,
        })
      ).error,
    ).not.toBeNull();

    expect((await run(lineup)).data).toEqual({ created: 1, players: 2 });
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
    // One withheld player, so the match isn't complete yet.
    expect(
      (
        await anon
          .from('fixtures')
          .select('withheld_count, stats_complete')
          .eq('id', fixtureId)
          .single()
      ).data,
    ).toEqual({
      withheld_count: 1,
      stats_complete: false,
    });

    // The manager adds the withheld player and player of the match.
    await boss.db.rpc('save_match_stats', {
      p_fixture_id: fixtureId,
      p_goals_for: 3,
      p_goals_against: 0,
      p_stats: [
        { player_id: linked.id, goals: 2, yellow_cards: 1, player_of_match: true },
        { player_id: keeper.id },
        { player_id: wendy, goals: 1, assists: 1 },
      ],
      p_complete: true,
    });

    // The next sync updates England Hockey's goals but keeps the manager's work.
    lineup[0]!.goals = 3;
    expect((await run(lineup)).data).toEqual({ created: 0, players: 2 });
    const perfs = (await anon.from('performances').select('*').eq('fixture_id', fixtureId)).data!;
    expect(perfs).toHaveLength(3);
    expect(perfs.find((p) => p.player_id === linked.id)).toMatchObject({
      goals: 3,
      yellow_cards: 1,
      player_of_match: true,
    });
    expect(perfs.find((p) => p.player_id === wendy)).toMatchObject({ goals: 1, assists: 1 });
    expect(
      (await anon.from('fixtures').select('stats_complete').eq('id', fixtureId).single()).data
        ?.stats_complete,
    ).toBe(true);

    // Someone removed from the England Hockey line-up goes; manual players stay.
    await run([lineup[0]]);
    expect(
      (await anon.from('performances').select('player_id').eq('fixture_id', fixtureId))
        .data!.map((p) => p.player_id)
        .sort(),
    ).toEqual([linked.id, wendy].sort());

    // An empty line-up changes nothing; a locked match is skipped entirely.
    await run([]);
    expect(
      (await anon.from('performances').select('id').eq('fixture_id', fixtureId)).data,
    ).toHaveLength(2);
    expect(
      (await alice.db.rpc('set_stats_lock', { p_fixture_id: fixtureId, p_locked: true })).error,
    ).not.toBeNull();
    await boss.db.rpc('set_stats_lock', { p_fixture_id: fixtureId, p_locked: true });
    expect((await run(lineup)).data).toEqual({ skipped: true });
    expect(
      (await anon.from('performances').select('id').eq('fixture_id', fixtureId)).data,
    ).toHaveLength(2);
  });

  it('imports withheld players under a placeholder, keeps a corrected name, and merges', async () => {
    const m3 = sides[2]!.id;
    const mk = async (eh: string) =>
      (
        await service
          .from('fixtures')
          .insert({
            side_id: m3,
            kickoff: '2026-09-19T14:00:00+01:00',
            opponent: eh,
            gameweek_id: 0,
            goals_for: 2,
            goals_against: 1,
            eh_fixture_id: eh,
          })
          .select('id')
          .single()
      ).data!.id;
    const f1 = await mk('eh-withheld-1');
    const f2 = await mk('eh-withheld-2');
    const hidden = {
      member_id: 'm-hidden',
      name: null,
      withheld: true,
      shirt: '7',
      is_gk: false,
      goals: 2,
      green_cards: 1,
      yellow_cards: 0,
      red_cards: 0,
    };
    const res = await service.rpc('import_lineup', {
      p_fixture_id: f1,
      p_players: [hidden] as never,
      p_withheld: 0,
    });
    expect(res.data).toEqual({ created: 1, players: 1 });
    const placeholder = (
      await anon.from('players').select('*').eq('eh_member_id', 'm-hidden').single()
    ).data!;
    expect(placeholder).toMatchObject({
      name: 'Name withheld #7 (M3)',
      name_withheld: true,
      needs_review: true,
    });
    expect(
      (await anon.from('performances').select('goals, green_cards').eq('fixture_id', f1).single())
        .data,
    ).toEqual({ goals: 2, green_cards: 1 });

    // The manager corrects the name; the next sync keeps it.
    await boss.db.from('players').update({ name: 'Real Person' }).eq('id', placeholder.id);
    await service.rpc('import_lineup', {
      p_fixture_id: f2,
      p_players: [{ ...hidden, goals: 1 }] as never,
      p_withheld: 0,
    });
    expect(
      (await anon.from('players').select('name, name_withheld').eq('id', placeholder.id).single())
        .data,
    ).toEqual({
      name: 'Real Person',
      name_withheld: false,
    });
    expect(
      (await anon.from('performances').select('player_id').eq('fixture_id', f2).single()).data
        ?.player_id,
    ).toBe(placeholder.id);

    // A second withheld player turns out to be someone the manager added by hand.
    const manual = (
      await boss.db
        .from('players')
        .insert({ name: 'Hand Added', position: 'MID', side_id: m3, price: 55 })
        .select('id')
        .single()
    ).data!.id;
    await boss.db.rpc('save_match_stats', {
      p_fixture_id: f1,
      p_goals_for: 2,
      p_goals_against: 1,
      p_stats: [
        { player_id: placeholder.id, goals: 2, green_cards: 1 },
        { player_id: manual, goals: 0, player_of_match: true },
      ],
      p_complete: true,
    });
    await service.rpc('import_lineup', {
      p_fixture_id: f1,
      p_players: [
        hidden,
        {
          ...hidden,
          member_id: 'm-hidden-2',
          shirt: '9',
          goals: 0,
          green_cards: 0,
          yellow_cards: 1,
        },
      ] as never,
      p_withheld: 0,
    });
    const dupe = (await anon.from('players').select('id').eq('eh_member_id', 'm-hidden-2').single())
      .data!.id;
    expect(
      (await alice.db.rpc('merge_players', { p_from: dupe, p_into: manual })).error,
    ).not.toBeNull();
    expect((await boss.db.rpc('merge_players', { p_from: dupe, p_into: manual })).error).toBeNull();

    expect((await anon.from('players').select('id').eq('id', dupe)).data).toEqual([]);
    expect(
      (await anon.from('players').select('eh_member_id').eq('id', manual).single()).data
        ?.eh_member_id,
    ).toBe('m-hidden-2');
    // One row for the merged player: England Hockey's card, the manager's player of the match.
    expect(
      (
        await anon
          .from('performances')
          .select('player_id, yellow_cards, player_of_match')
          .eq('fixture_id', f1)
          .eq('player_id', manual)
      ).data,
    ).toEqual([{ player_id: manual, yellow_cards: 1, player_of_match: true }]);
    // Later syncs now land on the merged player.
    await service.rpc('import_lineup', {
      p_fixture_id: f2,
      p_players: [{ ...hidden, member_id: 'm-hidden-2' }] as never,
      p_withheld: 0,
    });
    expect(
      (
        await anon
          .from('performances')
          .select('player_id')
          .eq('fixture_id', f2)
          .eq('player_id', manual)
      ).data,
    ).toHaveLength(1);
    // Two different England Hockey people can't be merged.
    expect(
      (await boss.db.rpc('merge_players', { p_from: placeholder.id, p_into: manual })).error
        ?.message,
    ).toMatch(/different people/);
  });

  it('prices players from points, then moves them weekly by form', async () => {
    expect((await alice.db.rpc('set_prices_from_points')).error?.message).toMatch(/managers only/i);
    expect((await anon.rpc('apply_due_price_changes')).error).not.toBeNull();
    // Nothing moves before starting prices exist.
    expect((await service.rpc('apply_due_price_changes')).data).toMatchObject({
      weeks: 0,
      waiting_for_starting_prices: true,
    });

    const { data: count } = await boss.db.rpc('set_prices_from_points');
    const all = (await anon.from('players').select('id, position, price')).data!;
    expect(count).toBe(all.length);
    expect(all.every((p) => p.price >= 40 && p.price <= 100 && p.price % 5 === 0)).toBe(true);
    // Spread across the range, not bunched at the top.
    const avg = all.reduce((sum, p) => sum + p.price, 0) / all.length;
    expect(avg).toBeGreaterThan(55);
    expect(avg).toBeLessThan(85);
    // More points always means a price at least as high, whatever the position.
    const season = new Map(
      ((await anon.from('player_season_points').select('*')).data ?? []).map((r) => [
        r.player_id,
        r.points ?? 0,
      ]),
    );
    const pts = (id: number) => season.get(id) ?? 0;
    for (const a of all) {
      for (const b of all) {
        if (pts(a.id) > pts(b.id)) expect(a.price).toBeGreaterThanOrEqual(b.price);
      }
    }
    const top = [...all].sort((a, b) => pts(b.id) - pts(a.id))[0]!;
    expect(top.price).toBe(100);
    const locked = (
      await anon.from('gameweeks').select('id').lte('deadline', new Date().toISOString())
    ).data!;
    expect((await anon.from('gameweek_pricing').select('gameweek_id')).data).toHaveLength(
      locked.length,
    );

    // A finished weekend after pricing started: two defenders, one great, one poor.
    const [good, poor] = [playerIds[1]!, playerIds[2]!];
    await service.from('players').update({ price: 60 }).in('id', [good, poor]);
    const fixtureId = (
      await service
        .from('fixtures')
        .insert({
          side_id: sides[0]!.id,
          kickoff: '2026-08-01T14:00:00+01:00',
          opponent: 'Pricing Opp',
          gameweek_id: 0,
          goals_for: 2,
          goals_against: 4,
        })
        .select('id, gameweek_id')
        .single()
    ).data!;
    const inserted = await service.from('performances').insert([
      { fixture_id: fixtureId.id, player_id: good, goals: 2, yellow_cards: 0 },
      { fixture_id: fixtureId.id, player_id: poor, goals: 0, yellow_cards: 1 },
    ]);
    expect(inserted.error).toBeNull();
    expect((await service.rpc('apply_due_price_changes')).data).toEqual({ weeks: 1, changes: 2 });
    const after = (await anon.from('players').select('id, price').in('id', [good, poor])).data!;
    expect(after.find((p) => p.id === good)!.price).toBe(63);
    expect(after.find((p) => p.id === poor)!.price).toBe(58);
    const trend = (
      await anon
        .from('player_price_trend')
        .select('player_id, change')
        .in('player_id', [good, poor])
    ).data!;
    expect(trend.find((t) => t.player_id === good)!.change).toBe(3);
    // Each gameweek moves prices once.
    expect((await service.rpc('apply_due_price_changes')).data).toEqual({ weeks: 0, changes: 0 });
  });

  it('imports Pitchero team sheets and players of the match without overriding managers', async () => {
    const w1 = sides[4]!.id;
    const mk = async (opp: string) =>
      (
        await service
          .from('fixtures')
          .insert({
            side_id: w1,
            kickoff: '2026-09-26T12:00:00+01:00',
            opponent: opp,
            gameweek_id: 0,
            goals_for: 1,
            goals_against: 0,
          })
          .select('id')
          .single()
      ).data!.id;
    const f1 = await mk('Pitchero A');
    const f2 = await mk('Pitchero B');
    const tom = (
      await boss.db
        .from('players')
        .insert({ name: 'Tom Rattle', position: 'MID', side_id: w1, price: 50 })
        .select('id')
        .single()
    ).data!.id;
    const sue = (
      await boss.db
        .from('players')
        .insert({ name: 'Sue Smith', position: 'MID', side_id: w1, price: 50 })
        .select('id')
        .single()
    ).data!.id;
    for (const f of [f1, f2]) {
      await service.from('performances').insert([
        { fixture_id: f, player_id: tom, goals: 0, player_of_match: false },
        { fixture_id: f, player_id: sue, goals: 0, player_of_match: false },
      ]);
    }
    const lineup = [
      {
        pitchero_player_id: 1,
        name: 'Thomas Rattle',
        shirt: '7',
        position: 'Fullback',
        starter: true,
      },
      { pitchero_player_id: 2, name: 'Sue Smith', shirt: '9', position: 'Forward', starter: true },
    ];
    expect(
      (
        await alice.db.rpc('import_pitchero', {
          p_fixture_id: f1,
          p_lineup: lineup as never,
          p_potm: [] as never,
        })
      ).error,
    ).not.toBeNull();

    // "Thomas" on Pitchero is "Tom" here: same initial and surname within the match.
    expect(
      (
        await service.rpc('import_pitchero', {
          p_fixture_id: f1,
          p_lineup: lineup as never,
          p_potm: ['Thomas Rattle'] as never,
        })
      ).data,
    ).toEqual({ players: 2, potm: 1 });
    expect(
      (await anon.from('pitchero_lineups').select('name, position').eq('fixture_id', f1)).data,
    ).toHaveLength(2);
    const pom = async (f: number) =>
      (
        await anon
          .from('performances')
          .select('player_id')
          .eq('fixture_id', f)
          .eq('player_of_match', true)
      ).data!.map((r) => r.player_id);
    expect(await pom(f1)).toEqual([tom]);

    // A match that already has a player of the match keeps the manager's choice.
    await service
      .from('performances')
      .update({ player_of_match: true })
      .eq('fixture_id', f2)
      .eq('player_id', sue);
    await service.rpc('import_pitchero', {
      p_fixture_id: f2,
      p_lineup: lineup as never,
      p_potm: ['Thomas Rattle'] as never,
    });
    expect(await pom(f2)).toEqual([sue]);

    // Locked matches aren't touched either.
    await service.from('performances').update({ player_of_match: false }).eq('fixture_id', f2);
    await boss.db.rpc('set_stats_lock', { p_fixture_id: f2, p_locked: true });
    await service.rpc('import_pitchero', {
      p_fixture_id: f2,
      p_lineup: lineup as never,
      p_potm: ['Sue Smith'] as never,
    });
    expect(await pom(f2)).toEqual([]);
  });

  describe('chips', () => {
    let carol: { db: Db; id: string };
    const id = (i: number) => playerIds[i]!;
    // 0 GK, 1-4 DEF, 5-8 MID, 9-10 FWD, 11 GK, 12 FWD, 13 DEF, 14 GK, 15 DEF, 16 MID, 17 FWD
    const starters = () => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(id);
    const bench = () => [14, 15, 16, 17].map(id);
    const save = (who: { db: Db }, xi: number[], captain = xi[9]!, vice = xi[10]!) =>
      who.db.rpc('save_squad', {
        p_starters: xi,
        p_bench: bench(),
        p_captain_id: captain,
        p_vice_id: vice,
      });
    const openGameweek = async () =>
      (
        await anon
          .from('gameweeks')
          .select('id')
          .gt('deadline', new Date().toISOString())
          .order('start_date')
          .limit(1)
          .single()
      ).data!.id;
    const lock = (gw: number) =>
      service
        .from('gameweeks')
        .update({ deadline: days(-1) })
        .eq('id', gw);

    beforeAll(async () => {
      carol = await signUp('carol@example.com', 'Carol XI');
      await service.from('players').update({ price: 60, active: true }).in('id', playerIds);
      for (const n of [24, 31, 38]) {
        await service.from('fixtures').insert({
          side_id: sides[0]!.id,
          kickoff: days(n),
          opponent: `Chip Opp ${n}`,
          gameweek_id: 0,
        });
      }
    });

    it('plays, swaps and cancels a chip before the deadline, hidden from others', async () => {
      const gw = await openGameweek();
      expect((await save(carol, starters())).error).toBeNull();
      expect((await carol.db.rpc('play_chip', { p_chip: 'team_bus' })).error!.message).toMatch(
        /Choose a side/,
      );
      expect((await carol.db.rpc('play_chip', { p_chip: 'rolling_subs' })).data).toBe(gw);
      // Changing your mind swaps it: still one chip per gameweek.
      expect((await carol.db.rpc('play_chip', { p_chip: 'triple_captain' })).error).toBeNull();
      const mine = (await carol.db.from('chips_played').select('chip, gameweek_id')).data;
      expect(mine).toEqual([{ chip: 'triple_captain', gameweek_id: gw }]);
      expect((await bob.db.from('chips_played').select('*').eq('user_id', carol.id)).data).toEqual(
        [],
      );
      expect((await carol.db.rpc('cancel_chip')).error).toBeNull();
      expect((await carol.db.from('chips_played').select('*')).data).toEqual([]);
      // Played for real this time: it's spent once the deadline passes.
      await carol.db.rpc('play_chip', { p_chip: 'triple_captain' });
      await lock(gw);
      expect(
        (await bob.db.from('chips_played').select('chip').eq('user_id', carol.id)).data,
      ).toEqual([{ chip: 'triple_captain' }]);
    });

    it('uses each chip once, and the wildcard lifts the transfer limit for good', async () => {
      expect(
        (await carol.db.rpc('play_chip', { p_chip: 'triple_captain' })).error!.message,
      ).toMatch(/already used that chip/);

      // Three transfers: over the limit of 2...
      const changed = [11, 13, 2, 3, 4, 5, 6, 7, 8, 12, 10].map(id);
      expect((await save(carol, changed)).error!.message).toMatch(/3 transfers; only 2 allowed/);
      // ...until the wildcard is played, which can't then be taken back.
      expect((await carol.db.rpc('play_chip', { p_chip: 'wildcard' })).error).toBeNull();
      expect((await save(carol, changed)).error).toBeNull();
      expect((await carol.db.rpc('cancel_chip')).error!.message).toMatch(/can't be taken back/);
      expect((await carol.db.rpc('play_chip', { p_chip: 'rolling_subs' })).error!.message).toMatch(
        /can't be taken back/,
      );

      // One wildcard per half of the season.
      await lock(await openGameweek());
      expect((await carol.db.rpc('play_chip', { p_chip: 'wildcard' })).error!.message).toMatch(
        /already used your wildcard for this half/,
      );
      expect((await anon.rpc('season_half', { p_date: '2026-11-01' })).data).toBe(1);
      expect((await anon.rpc('season_half', { p_date: '2027-02-01' })).data).toBe(2);
    });

    it('scores Triple Captain, Rolling Subs and Team Bus', async () => {
      // Three finished gameweeks, each with a Felixstowe 1s and a 2s match.
      const m1 = sides[0]!.id;
      const m2 = sides[1]!.id;
      const weeks: { gw: number; f1: number; f2: number }[] = [];
      for (const n of [-21, -28, -35]) {
        const f1 = (
          await service
            .from('fixtures')
            .insert({ side_id: m1, kickoff: days(n), opponent: 'Past A', gameweek_id: 0 })
            .select('id, gameweek_id')
            .single()
        ).data!;
        const f2 = (
          await service
            .from('fixtures')
            .insert({ side_id: m2, kickoff: days(n), opponent: 'Past B', gameweek_id: 0 })
            .select('id')
            .single()
        ).data!;
        weeks.push({ gw: f1.gameweek_id, f1: f1.id, f2: f2.id });
      }
      const xi = starters();
      const captain = xi[9]!;
      const subs = bench();
      for (const w of weeks) {
        await service.from('picks').insert(
          [...xi, ...subs].map((p, i) => ({
            user_id: carol.id,
            gameweek_id: w.gw,
            player_id: p,
            is_captain: p === captain,
            is_vice: p === xi[10],
            bench_order: i < 11 ? null : i - 10,
          })),
        );
        // Everyone plays: starters and subs 1-2 for the 1s, the rest for the 2s.
        const for1 = [...xi.slice(0, 10), subs[0]!, subs[1]!];
        const for2 = [xi[10]!, subs[2]!, subs[3]!];
        await boss.db.rpc('save_match_stats', {
          p_fixture_id: w.f1,
          p_goals_for: 2,
          p_goals_against: 1,
          p_stats: for1.map((p) => ({ player_id: p, goals: p === captain ? 1 : 0 })),
          p_complete: true,
        });
        await boss.db.rpc('save_match_stats', {
          p_fixture_id: w.f2,
          p_goals_for: 0,
          p_goals_against: 3,
          p_stats: for2.map((p) => ({ player_id: p, goals: 0 })),
          p_complete: true,
        });
      }
      const [triple, rolling, bus] = weeks as [
        (typeof weeks)[0],
        (typeof weeks)[0],
        (typeof weeks)[0],
      ];
      await service.from('chips_played').insert([
        { user_id: carol.id, gameweek_id: triple.gw, chip: 'triple_captain', side_id: null },
        { user_id: carol.id, gameweek_id: rolling.gw, chip: 'rolling_subs', side_id: null },
        { user_id: carol.id, gameweek_id: bus.gw, chip: 'team_bus', side_id: m1 },
      ]);

      const scored = async (gw: number) => {
        const { data, error } = await carol.db.rpc('squad_for', {
          p_user: carol.id,
          p_gameweek: gw,
        });
        expect(error).toBeNull();
        const base = new Map(
          (
            await anon
              .from('player_gameweek_points')
              .select('player_id, points')
              .eq('gameweek_id', gw)
          ).data!.map((r) => [r.player_id, r.points!]),
        );
        return { rows: new Map(data!.map((r) => [r.player_id, r])), base };
      };

      // Triple Captain: 3x the captain, everyone else as scored, subs don't count.
      let { rows, base } = await scored(triple.gw);
      expect(rows.get(captain)!.points).toBe(base.get(captain)! * 3);
      expect(rows.get(xi[0]!)!.points).toBe(base.get(xi[0]!));
      expect(subs.every((p) => !rows.get(p)!.counts)).toBe(true);

      // Rolling Subs: all 15 count, captain doubled as usual.
      ({ rows, base } = await scored(rolling.gw));
      expect([...rows.values()].every((r) => r.counts)).toBe(true);
      expect(rows.get(captain)!.points).toBe(base.get(captain)! * 2);
      const all = [...rows.values()].reduce((sum, r) => sum + r.points, 0);
      expect(all).toBe([...base.values()].reduce((a, b) => a + b, 0) + base.get(captain)!);

      // Team Bus on the 1s: their points double (the captain's on top of the
      // armband); the vice played for the 2s, so no bus bonus.
      ({ rows, base } = await scored(bus.gw));
      expect(rows.get(xi[0]!)).toMatchObject({ points: base.get(xi[0]!)! * 2 });
      expect(rows.get(captain)!.points).toBe(base.get(captain)! * 4);
      expect(rows.get(xi[10]!)).toMatchObject({ points: base.get(xi[10]!), bus_points: 0 });

      // The league table adds it all up.
      const { data: table } = await anon.rpc('league_table');
      const total = table!.find((r) => r.user_id === carol.id)!.total;
      let expected = 0;
      // (Squads carry forward, so every locked gameweek counts, not just these.)
      const locked = (
        await anon.from('gameweeks').select('id').lte('deadline', new Date().toISOString())
      ).data!;
      for (const w of locked) {
        const { rows: r } = await scored(w.id);
        expected += [...r.values()].filter((x) => x.counts).reduce((sum, x) => sum + x.points, 0);
      }
      expect(total).toBe(expected);
    });

    it('needs 2 GK, 5 DEF, 5 MID, 3 FWD, and fixes an out-of-shape squad for free', async () => {
      const dave = await signUp('dave@example.com', 'Dave XI');
      const rpc = (xi: number[], subs: number[]) =>
        dave.db.rpc('save_squad', {
          p_starters: xi,
          p_bench: subs,
          p_captain_id: xi[9]!,
          p_vice_id: xi[8]!,
        });
      // A lopsided 15 (4 FWD, 4 DEF) is refused.
      const lopsided = await rpc(starters(), [14, 12, 16, 17].map(id));
      expect(lopsided.error!.message).toMatch(
        /needs 2 GK, 5 DEF, 5 MID and 3 FWD \(you have 2 GK, 4 DEF, 5 MID, 4 FWD\)/,
      );

      // The same lopsided squad saved last gameweek, before the rule (or
      // before a manager changed a position)...
      const open = await openGameweek();
      const before = (
        await anon
          .from('gameweeks')
          .select('id, start_date')
          .lte('deadline', new Date().toISOString())
          .order('start_date', { ascending: false })
          .limit(1)
          .single()
      ).data!.id;
      await service.from('picks').insert(
        [...starters(), ...[14, 12, 16, 17].map(id)].map((p, i) => ({
          user_id: dave.id,
          gameweek_id: before,
          player_id: p,
          is_captain: i === 9,
          is_vice: i === 8,
          bench_order: i < 11 ? null : i - 10,
        })),
      );
      // ...can be put right with 3 changes this week, over the limit of 2.
      const fixed = [11, 13, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(id);
      const res = await rpc(fixed, [14, 15, 16, 17].map(id));
      expect(res.error).toBeNull();
      expect(res.data).toBe(open);
    });
  });
});

describe.skipIf(!configured)('fixes from the code review', () => {
  const signIn = async (email: string) => {
    const db = createClient<Database>(URL!, ANON!, opts);
    const { data, error } = await db.auth.signInWithPassword({ email, password: 'password123' });
    if (error) throw error;
    return { db, id: data.user.id };
  };
  const fixture = async (side_id: number, kickoff: string, opponent: string) =>
    (
      await service
        .from('fixtures')
        .insert({ side_id, kickoff, opponent, gameweek_id: 0 })
        .select('id, gameweek_id')
        .single()
    ).data!;
  const deadlineOf = async (gw: number) =>
    (await anon.from('gameweeks').select('deadline').eq('id', gw).single()).data!.deadline;

  it('locks a gameweek an hour before its first game', async () => {
    const sides = (await service.from('sides').select('id').order('sort_order')).data!;
    // Saturday 15 May 2027 (BST). First game 14:00 UK: deadline 13:00 UK, 12:00 UTC.
    const sat = await fixture(sides[0]!.id, '2027-05-15T13:00:00+00:00', 'Saturday Opp');
    expect(await deadlineOf(sat.gameweek_id)).toBe('2027-05-15T12:00:00+00:00');
    // A game with no time yet (00:00) changes nothing.
    await fixture(sides[1]!.id, '2027-05-14T23:00:00+00:00', 'Time TBC'); // 00:00 UK on the 15th
    expect(await deadlineOf(sat.gameweek_id)).toBe('2027-05-15T12:00:00+00:00');
    // A Wednesday evening game brings it forward to an hour before.
    const wed = await fixture(sides[2]!.id, '2027-05-12T18:30:00+00:00', 'Midweek Opp');
    expect(wed.gameweek_id).toBe(sat.gameweek_id);
    expect(await deadlineOf(sat.gameweek_id)).toBe('2027-05-12T17:30:00+00:00');
    // Moved to the Sunday, it goes back to an hour before the Saturday game.
    await service
      .from('fixtures')
      .update({ kickoff: '2027-05-16T13:00:00+00:00' })
      .eq('id', wed.id);
    expect(await deadlineOf(sat.gameweek_id)).toBe('2027-05-15T12:00:00+00:00');
  });

  it('runs the safety-net syncs at Saturday 20:00 and Sunday 17:00 UK, either side of the clock change', async () => {
    const due = async (at: string) =>
      (await service.rpc('weekend_sync_due', { p_now: at })).data as boolean;
    // British Summer Time: Saturday 20:00 UK is 19:00 UTC.
    expect(await due('2026-10-17T19:00:00Z')).toBe(true);
    expect(await due('2026-10-17T20:00:00Z')).toBe(false);
    expect(await due('2026-10-18T16:05:00Z')).toBe(true); // Sunday 17:05 UK
    expect(await due('2026-10-18T16:15:00Z')).toBe(false); // too late in the hour
    // After the clocks go back (25 Oct): UK time is UTC.
    expect(await due('2026-10-31T20:00:00Z')).toBe(true);
    expect(await due('2026-10-31T19:00:00Z')).toBe(false);
    expect(await due('2026-11-01T17:00:00Z')).toBe(true);
    // Not on other days.
    expect(await due('2026-10-16T19:00:00Z')).toBe(false);
  });

  it('syncs two hours after each game should have finished (kick-off + 3h25)', async () => {
    const sides = (await service.from('sides').select('id').order('sort_order')).data!;
    const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();
    const due = await fixture(sides[0]!.id, ago(206), 'Sync Due');
    const early = await fixture(sides[1]!.id, ago(200), 'Sync Not Yet');
    const old = await fixture(sides[2]!.id, ago(4 * 24 * 60), 'Sync Too Old');
    const dueIds = async () =>
      ((await service.rpc('fixtures_due_for_sync')).data ?? []) as number[];
    let ids = await dueIds();
    expect(ids).toContain(due.id);
    expect(ids).not.toContain(early.id);
    expect(ids).not.toContain(old.id);
    // No Vault secrets locally: nothing is sent, and the game stays due.
    expect((await service.rpc('run_due_sync')).data).toBe(0);
    expect(await dueIds()).toContain(due.id);
    // Once synced it isn't due again, until its kick-off moves.
    await service
      .from('fixtures')
      .update({ auto_synced_at: new Date().toISOString() })
      .eq('id', due.id);
    expect(await dueIds()).not.toContain(due.id);
    await service
      .from('fixtures')
      .update({ kickoff: ago(210) })
      .eq('id', due.id);
    ids = await dueIds();
    expect(ids).toContain(due.id);
    // Not cluttering later tests.
    await service.from('fixtures').delete().in('id', [due.id, early.id, old.id]);
  });

  it('gives player of the match only to a clear name match', async () => {
    const side = (await service.from('sides').select('id').order('sort_order')).data![5]!.id;
    const f = (
      await service
        .from('fixtures')
        .insert({
          side_id: side,
          kickoff: '2026-09-27T12:00:00+01:00',
          opponent: 'Two Entwistles',
          gameweek_id: 0,
          goals_for: 2,
          goals_against: 1,
        })
        .select('id')
        .single()
    ).data!.id;
    const ids = (
      await service
        .from('players')
        .insert([
          { name: 'Sam Entwistle', position: 'MID', side_id: side, price: 50 },
          { name: 'Sophie Entwistle', position: 'MID', side_id: side, price: 50 },
        ])
        .select('id, name')
    ).data!;
    await service
      .from('performances')
      .insert(
        ids.map((p) => ({ fixture_id: f, player_id: p.id, goals: 0, player_of_match: false })),
      );
    const potm = async () =>
      (
        await anon
          .from('performances')
          .select('player_id')
          .eq('fixture_id', f)
          .eq('player_of_match', true)
      ).data!.map((r) => r.player_id);
    // "S Entwistle" could be either, so nobody gets it.
    await service.rpc('import_pitchero', {
      p_fixture_id: f,
      p_lineup: [] as never,
      p_potm: ['S. Entwistle'] as never,
    });
    expect(await potm()).toEqual([]);
    // The full name settles it.
    await service.rpc('import_pitchero', {
      p_fixture_id: f,
      p_lineup: [] as never,
      p_potm: ['Sophie Entwistle'] as never,
    });
    expect(await potm()).toEqual([ids.find((p) => p.name === 'Sophie Entwistle')!.id]);
  });

  it('gives chips back each season', async () => {
    const erin = await signUp('erin@example.com', 'Erin XI');
    const lastSeason = (
      await service
        .from('gameweeks')
        .insert({ start_date: '2025-10-04', deadline: '2025-10-04T09:00:00+00:00' })
        .select('id')
        .single()
    ).data!.id;
    await service
      .from('chips_played')
      .insert([{ user_id: erin.id, gameweek_id: lastSeason, chip: 'triple_captain' }]);
    const played = await erin.db.rpc('play_chip', { p_chip: 'triple_captain' });
    expect(played.error).toBeNull();
    // Once this season, though.
    await erin.db.rpc('cancel_chip');
    const thisSeason = (
      await service
        .from('gameweeks')
        .select('id')
        .lte('deadline', new Date().toISOString())
        .gte('start_date', '2026-07-01')
        .limit(1)
        .single()
    ).data!.id;
    await service
      .from('chips_played')
      .insert([{ user_id: erin.id, gameweek_id: thisSeason, chip: 'triple_captain' }]);
    expect((await erin.db.rpc('play_chip', { p_chip: 'triple_captain' })).error!.message).toMatch(
      /already used that chip this season/,
    );
  });

  it('keeps the armband and starting place when merging two picked players', async () => {
    const boss = await signIn('boss@example.com');
    const frank = await signUp('frank@example.com', 'Frank XI');
    const side = (await service.from('sides').select('id').order('sort_order')).data![0]!.id;
    const [from, into] = (
      await service
        .from('players')
        .insert([
          { name: 'Name withheld #99 (M1)', position: 'FWD', side_id: side, price: 50 },
          { name: 'Real Ninety-Nine', position: 'FWD', side_id: side, price: 50 },
        ])
        .select('id')
    ).data!.map((p) => p.id);
    const gw = (
      await service
        .from('gameweeks')
        .select('id')
        .lte('deadline', new Date().toISOString())
        .limit(1)
        .single()
    ).data!.id;
    await service.from('picks').insert([
      { user_id: frank.id, gameweek_id: gw, player_id: from!, is_captain: true, bench_order: null },
      { user_id: frank.id, gameweek_id: gw, player_id: into!, is_captain: false, bench_order: 2 },
    ]);
    const merged = await boss.db.rpc('merge_players', { p_from: from!, p_into: into! });
    expect(merged.error).toBeNull();
    const picks = (
      await service
        .from('picks')
        .select('player_id, is_captain, bench_order')
        .eq('user_id', frank.id)
        .eq('gameweek_id', gw)
    ).data!;
    expect(picks).toEqual([{ player_id: into, is_captain: true, bench_order: null }]);
  });

  it('keeps the league table up to date when points change', async () => {
    const locked = (
      await anon.from('gameweeks').select('id').lte('deadline', new Date().toISOString())
    ).data!;
    // What the table should say, worked out afresh for each locked gameweek.
    const fresh = async (user: string) => {
      let sum = 0;
      for (const w of locked) {
        const { data } = await anon.rpc('squad_for', { p_user: user, p_gameweek: w.id });
        sum += (data ?? []).reduce((n, r) => n + (r.counts ? r.points : 0), 0);
      }
      return sum;
    };
    const before = (await anon.rpc('league_table')).data!;
    expect((await anon.rpc('league_table')).data).toEqual(before);
    const top = before.find((r) => r.total > 0)!;
    expect(top.total).toBe(await fresh(top.user_id));

    // A goal for one of their players: the table follows.
    const { data: picks } = await service
      .from('picks')
      .select('player_id')
      .eq('user_id', top.user_id);
    const { data: perfs } = await service
      .from('performances')
      .select('id, goals')
      .in('player_id', [...new Set(picks!.map((p) => p.player_id))]);
    const perf = perfs![0]!;
    await service
      .from('performances')
      .update({ goals: perf.goals + 1 })
      .eq('id', perf.id);
    const after = (await anon.rpc('league_table')).data!.find((r) => r.user_id === top.user_id)!;
    expect(after.total).toBe(await fresh(top.user_id));
    await service.from('performances').update({ goals: perf.goals }).eq('id', perf.id);
    const back = (await anon.rpc('league_table')).data!.find((r) => r.user_id === top.user_id)!;
    expect(back.total).toBe(top.total);
  });
});
