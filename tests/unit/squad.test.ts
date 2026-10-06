import {
  autoArrange,
  autoPick,
  fitsQuota,
  formatPrice,
  isValidArrangement,
  parsePrice,
  summariseSquad,
  type SquadPlayer,
} from '@/lib/squad';

const settings = {
  budget: 1000,
  squad_size: 15,
  max_per_side: 5,
  transfers_per_gameweek: 2,
  formations: ['4-4-2', '4-3-3', '3-5-2'],
};
const shape = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD'] as const;
const benchShape = ['GK', 'DEF', 'MID', 'FWD'] as const;

function player(id: number, position: SquadPlayer['position'], price: number): SquadPlayer {
  return {
    id,
    name: `P${id}`,
    position,
    side_id: (id % 4) + 1,
    side_name: `Side ${(id % 4) + 1}`,
    price,
    active: true,
  };
}
function xi(price = 60): SquadPlayer[] {
  return shape.map((position, i) => player(i + 1, position, price));
}
function subs(price = 40): SquadPlayer[] {
  return benchShape.map((position, i) => player(i + 12, position, price));
}
const allIds = Array.from({ length: 15 }, (_, i) => i + 1);

describe('summariseSquad', () => {
  it('accepts 11 starters and 4 subs', () => {
    const s = summariseSquad(xi(), subs(), 1, 2, settings, [], []);
    expect(s.problems).toEqual([]);
    expect(s.count).toBe(15);
    expect(s.cost).toBe(660 + 160);
    expect(s.transfers).toBeNull();
  });

  it('flags formation, budget, per-side and captain problems', () => {
    const players = xi(100).slice(1); // no GK
    players.push({ ...players[0]!, id: 99, side_id: 2, side_name: 'Side 2', price: 200 });
    const s = summariseSquad(players, subs(), 42, 2, { ...settings, max_per_side: 3 }, [], []);
    expect(s.problems.join(' ')).toMatch(/1 goalkeeper/);
    expect(s.problems.join(' ')).toMatch(/more than you can spend/);
    expect(s.problems.join(' ')).toMatch(/Max 3 players from Side/);
    expect(s.problems.join(' ')).toMatch(/captain/);
  });

  it('needs a sub keeper first and outfield subs after', () => {
    const bench = subs();
    const swapped = [bench[1]!, bench[0]!, bench[2]!, bench[3]!];
    const s = summariseSquad(xi(), swapped, 1, 2, settings, [], []);
    expect(s.problems).toContain('The first sub must be a goalkeeper.');
    expect(s.problems).toContain('Subs 1 to 3 must be outfield players.');
    const short = summariseSquad(xi(), [bench[0]!, null, bench[2]!, null], 1, 2, settings, [], []);
    expect(short.problems).toContain('Pick 4 subs (you have 2).');
  });

  it('only captains a starter', () => {
    expect(summariseSquad(xi(), subs(), 13, 2, settings, [], []).problems).toEqual([
      'Choose a captain from your starting 11.',
    ]);
  });

  it('needs a vice-captain who starts and is not the captain', () => {
    const vice = 'Choose a vice-captain from your starting 11 (not the captain).';
    expect(summariseSquad(xi(), subs(), 1, null, settings, [], []).problems).toEqual([vice]);
    expect(summariseSquad(xi(), subs(), 1, 1, settings, [], []).problems).toEqual([vice]);
    expect(summariseSquad(xi(), subs(), 1, 13, settings, [], []).problems).toEqual([vice]);
  });

  it('only allows the league formations, for the starting 11', () => {
    expect(
      summariseSquad(xi(), subs(), 1, 2, { ...settings, formations: ['4-3-3'] }, [], []).problems,
    ).toEqual(["That's a 4-4-2. Pick one of: 4-3-3."]);
  });

  it('counts transfers against the previous squad', () => {
    const previous = [1, 2, 3, 4, 5, 6, 7, 8, 50, 51, 52, 12, 13, 14, 15];
    const s = summariseSquad(xi(), subs(), 1, 2, settings, [], previous);
    expect(s.transfers).toBe(3);
    expect(s.problems.join(' ')).toMatch(/3 transfers/);
  });

  it('lets an 11-player squad from before the bench add 4 subs for free', () => {
    const before = allIds.slice(0, 11);
    const s = summariseSquad(xi(), subs(), 1, 2, settings, before, before);
    expect(s.transfers).toBe(0);
    expect(s.problems).toEqual([]);
  });

  it('keeps an unchanged squad valid however its prices moved', () => {
    const s = summariseSquad(xi(100), subs(100), 1, 2, settings, allIds, allIds, {
      base: 30,
      priceOf: () => 100,
    });
    expect(s.problems).toEqual([]);
    expect(s.bank).toBe(30);
  });

  it("sells at today's price, so a player who rose funds a dearer buy", () => {
    // Bank 1.0m. Sell player 2 (now 9.0m) and buy a 9.5m player.
    const after = xi();
    after[1] = { ...after[1]!, id: 99, price: 95 };
    const priceOf = (id: number) => (id === 2 ? 90 : 60);
    const s = summariseSquad(after, subs(), 1, 3, settings, allIds, allIds, { base: 10, priceOf });
    expect(s.bank).toBe(10 + 90 - 95);
    expect(s.problems).toEqual([]);
    const fell = summariseSquad(after, subs(), 1, 3, settings, allIds, allIds, {
      base: 10,
      priceOf: () => 70,
    });
    expect(fell.bank).toBe(10 + 70 - 95);
    expect(fell.problems).toContain("That's 1.5m more than you can spend.");
  });

  it('blocks newly picking an inactive player but keeps an existing one', () => {
    const players = xi();
    players[3] = { ...players[3]!, active: false };
    expect(summariseSquad(players, subs(), 1, 2, settings, [], []).problems.join(' ')).toMatch(
      /isn't available/,
    );
    expect(summariseSquad(players, subs(), 1, 2, settings, [4], []).problems).toEqual([]);
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

describe('autoArrange', () => {
  const formations = ['4-4-2', '4-3-3', '3-5-2'];
  const fifteen = () => [...xi(), ...subs()]; // 2 GK, 5 DEF, 5 MID, 3 FWD

  it('starts one keeper and fills an allowed formation, the rest on the bench', () => {
    const a = autoArrange(fifteen(), formations)!;
    expect(a.starters).toHaveLength(11);
    expect(a.bench[0]).toBe(12); // the other keeper
    const starters = fifteen().filter((p) => a.starters.includes(p.id));
    const bench = a.bench.map((id) => fifteen().find((p) => p.id === id)!);
    expect(isValidArrangement(starters, bench, formations)).toBe(true);
  });

  it('keeps the shape and players the user already started', () => {
    // Starters as saved: the 3-5-2 made by 1 GK, DEF 2-4 and 13, MID 6-9 and 14, FWD 10-11.
    const order = [1, 2, 3, 4, 6, 7, 8, 9, 14, 10, 11];
    const a = autoArrange(fifteen(), formations, order)!;
    expect(a.starters.sort((x, y) => x - y)).toEqual([...order].sort((x, y) => x - y));
  });

  it('gives up when no formation fits', () => {
    const noForwards = fifteen().map((p) =>
      p.position === 'FWD' ? { ...p, position: 'MID' as const } : p,
    );
    expect(autoArrange(noForwards, ['4-4-2'])).toBeNull();
  });
});

describe('squad make-up', () => {
  it('needs 2 GK, 5 DEF, 5 MID and 3 FWD', () => {
    const bench = subs();
    bench[3] = { ...bench[3]!, position: 'MID' }; // 6 MID, 2 FWD
    expect(summariseSquad(xi(), bench, 1, 2, settings, [], []).problems).toContain(
      'Your 15 needs 2 GK, 5 DEF, 5 MID and 3 FWD (you have 2 GK, 5 DEF, 6 MID, 2 FWD).',
    );
    expect(fitsQuota({ GK: 2, DEF: 5, MID: 5, FWD: 3 })).toBe(true);
  });
});

describe('autoPick', () => {
  const mk = (
    id: number,
    position: 'GK' | 'DEF' | 'MID' | 'FWD',
    price: number,
    side = id % 4,
  ) => ({
    id,
    name: `P${id}`,
    position,
    side_id: side,
    side_name: '',
    price,
    active: true,
  });
  // Plenty of each position at a range of prices.
  const pool = [
    ...[1, 2, 3, 4].map((i) => mk(i, 'GK', 40 + i * 5)),
    ...[10, 11, 12, 13, 14, 15, 16, 17].map((i) => mk(i, 'DEF', 40 + (i - 10) * 5)),
    ...[20, 21, 22, 23, 24, 25, 26, 27].map((i) => mk(i, 'MID', 40 + (i - 20) * 10)),
    ...[30, 31, 32, 33, 34, 35].map((i) => mk(i, 'FWD', 45 + (i - 30) * 10)),
  ];
  const score = (id: number) => id % 10; // higher id in a block scores more

  it('fills an empty squad to 2/5/5/3 within the bank and side limit', () => {
    const picked = autoPick({ squad: [], pool, bank: 1000, maxPerSide: 5, score })!;
    const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const p of picked) counts[p.position] += 1;
    expect(counts).toEqual({ GK: 2, DEF: 5, MID: 5, FWD: 3 });
    expect(picked.reduce((s, p) => s + p.price, 0)).toBeLessThanOrEqual(1000);
    const sides = new Map<number, number>();
    for (const p of picked) sides.set(p.side_id, (sides.get(p.side_id) ?? 0) + 1);
    expect(Math.max(...sides.values())).toBeLessThanOrEqual(5);
  });

  it('only fills the gaps and keeps money for them', () => {
    const squad = pool.filter((p) =>
      [1, 2, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24, 30, 31].includes(p.id),
    );
    // One forward short, 70 in the bank: the best forward it can afford.
    const picked = autoPick({
      squad,
      pool: pool.filter((p) => !squad.includes(p)),
      bank: 70,
      maxPerSide: 15,
      score,
    })!;
    expect(picked.map((p) => p.id)).toEqual([32]);
  });

  it('gives up when the bank cannot cover the places', () => {
    expect(autoPick({ squad: [], pool, bank: 300, maxPerSide: 5, score })).toBeNull();
  });
});
