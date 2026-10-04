import { formatPrice, parsePrice, summariseSquad, type SquadPlayer } from '@/lib/squad';

const settings = {
  budget: 1000,
  squad_size: 11,
  max_per_side: 4,
  transfers_per_gameweek: 2,
  formations: ['4-4-2', '4-3-3', '3-5-2'],
};
const shape = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD'] as const;

function squad(price = 80): SquadPlayer[] {
  return shape.map((position, i) => ({
    id: i + 1,
    name: `P${i + 1}`,
    position,
    side_id: (i % 4) + 1,
    side_name: `Side ${(i % 4) + 1}`,
    price,
    active: true,
  }));
}

describe('summariseSquad', () => {
  it('accepts a valid squad', () => {
    const s = summariseSquad(squad(), 1, settings, [], []);
    expect(s.problems).toEqual([]);
    expect(s.cost).toBe(880);
    expect(s.transfers).toBeNull();
  });

  it('flags formation, budget, per-side and captain problems', () => {
    const players = squad(100).slice(1); // no GK, 10 players, 1000 cost
    players.push({ ...players[0]!, id: 99, side_id: 2, side_name: 'Side 2', price: 200 });
    const s = summariseSquad(players, 42, { ...settings, max_per_side: 3 }, [], []);
    expect(s.problems.join(' ')).toMatch(/1 goalkeeper/);
    expect(s.problems.join(' ')).toMatch(/more than you can spend/);
    expect(s.problems.join(' ')).toMatch(/Max 3 players from Side/);
    expect(s.problems.join(' ')).toMatch(/captain/);
  });

  it('only allows the league formations', () => {
    const players = squad(); // 4-4-2
    expect(
      summariseSquad(players, 1, { ...settings, formations: ['4-3-3'] }, [], []).problems,
    ).toEqual(["That's a 4-4-2. Pick one of: 4-3-3."]);
  });

  it('counts transfers against the previous squad', () => {
    const players = squad();
    const previous = [1, 2, 3, 4, 5, 6, 7, 8, 50, 51, 52];
    const s = summariseSquad(players, 1, settings, [], previous);
    expect(s.transfers).toBe(3);
    expect(s.problems.join(' ')).toMatch(/3 transfers/);
  });

  it('keeps an unchanged squad valid however its prices moved', () => {
    const players = squad(100); // now worth 110.0m
    const ids = players.map((p) => p.id);
    const s = summariseSquad(players, 1, settings, ids, ids, { base: 30, priceOf: () => 100 });
    expect(s.problems).toEqual([]);
    expect(s.bank).toBe(30);
  });

  it("sells at today's price, so a player who rose funds a dearer buy", () => {
    // Bank 1.0m. Sell player 1 (bought cheap, now 9.0m) and buy a 9.5m player.
    const before = squad(80).map((p) => p.id);
    const after = squad(80);
    after[1] = { ...after[1]!, id: 99, price: 95 };
    const priceOf = (id: number) => (id === 2 ? 90 : 80);
    const s = summariseSquad(after, 1, settings, before, before, { base: 10, priceOf });
    expect(s.bank).toBe(10 + 90 - 95);
    expect(s.problems).toEqual([]);
    // Had that player fallen to 7.0m instead, the same buy is out of reach.
    const fell = summariseSquad(after, 1, settings, before, before, {
      base: 10,
      priceOf: () => 70,
    });
    expect(fell.bank).toBe(10 + 70 - 95);
    expect(fell.problems).toContain("That's 1.5m more than you can spend.");
  });

  it('blocks newly picking an inactive player but keeps an existing one', () => {
    const players = squad();
    players[3] = { ...players[3]!, active: false };
    expect(summariseSquad(players, 1, settings, [], []).problems.join(' ')).toMatch(
      /isn't available/,
    );
    expect(summariseSquad(players, 1, settings, [4], []).problems).toEqual([]);
  });
});

describe('prices', () => {
  it('round trips', () => {
    expect(formatPrice(85)).toBe('8.5');
    expect(parsePrice('8.5')).toBe(85);
    expect(parsePrice(' 6 ')).toBe(60);
    expect(parsePrice('abc')).toBeNull();
    expect(parsePrice('0')).toBeNull();
    expect(parsePrice('100.0')).toBeNull();
    expect(parsePrice('100.0', 10000)).toBe(1000);
  });
});
