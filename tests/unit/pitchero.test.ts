import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  nextData,
  parseFixtures,
  parseLineup,
  pickPitcheroMatch,
  type PitcheroFixture,
} from '../../supabase/functions/_shared/pitchero.ts';
import {
  mapPosition,
  nameKey,
  suggestPositions,
  suggestWithheldNames,
  type Appearance,
} from '@/lib/pitcheroMatch';

const load = (f: string) => JSON.parse(readFileSync(join(__dirname, '../fixtures', f), 'utf8'));

describe('Pitchero parsing (real pages, names anonymised)', () => {
  it('reads the fixture list', () => {
    const fixtures = parseFixtures(load('pitchero-fixtures.json'), 262265);
    expect(fixtures.length).toBe(8);
    expect(fixtures[0]).toMatchObject({
      id: expect.stringMatching(/^\d-\d+$/),
      date: expect.stringMatching(/^2026-/),
    });
  });

  it('reads a line-up with positions, shirts, subs and player of the match', () => {
    const lineup = parseLineup(load('pitchero-lineup.json'), 262265, '1-20245406');
    expect(lineup.players).toHaveLength(15);
    expect(lineup.players[0]).toMatchObject({ shirt: '1', position: 'Goal Keeper', starter: true });
    expect(lineup.players.filter((p) => !p.starter)).toHaveLength(4);
    expect(lineup.potm).toEqual([lineup.players[9]!.name]);
  });

  it('extracts page data', () => {
    expect(nextData('<script id="__NEXT_DATA__" type="application/json">{"a":1}</script>')).toEqual(
      { a: 1 },
    );
    expect(() => nextData('<html></html>')).toThrow();
  });
});

describe('name and position matching', () => {
  it('treats nicknames with the same initial and surname as one person', () => {
    expect(nameKey('Thomas Rattle')).toBe(nameKey('Tom Rattle'));
    expect(nameKey('Adam El-mahraoui')).toBe(nameKey('Adam El-Mahraoui'));
    expect(nameKey('James Alexander Grantham')).toBe(nameKey('James Grantham'));
  });

  it('maps Pitchero positions', () => {
    expect(mapPosition('Goal Keeper')).toBe('GK');
    expect(mapPosition('Fullback')).toBe('DEF');
    expect(mapPosition('Sweeper')).toBe('DEF');
    expect(mapPosition('Winger')).toBe('MID');
    expect(mapPosition('Forward')).toBe('FWD');
    expect(mapPosition(null)).toBeNull();
  });
});

describe('suggestWithheldNames', () => {
  // Two withheld players over three games. Named players: Ann (games 1-3), Bea (1-2).
  const a = (
    fixture_id: number,
    player_id: number,
    name: string,
    name_withheld = false,
  ): Appearance => ({
    fixture_id,
    player_id,
    name,
    name_withheld,
  });
  const appearances = [
    a(1, 1, 'Ann Able'),
    a(2, 1, 'Ann Able'),
    a(3, 1, 'Ann Able'),
    a(1, 2, 'Bea Best'),
    a(2, 2, 'Bea Best'),
    a(1, 10, 'Name withheld #a', true),
    a(2, 10, 'Name withheld #a', true),
    a(3, 10, 'Name withheld #a', true),
    a(1, 11, 'Name withheld #b', true),
    a(2, 11, 'Name withheld #b', true),
  ];
  const sheet = (fixture_id: number, names: string[]) =>
    names.map((name) => ({ fixture_id, name, position: null }));
  const pitchero = [
    ...sheet(1, ['Ann Able', 'Bea Best', 'Cat Cole', 'Dot Dunn']),
    ...sheet(2, ['Ann Able', 'Bea Best', 'Cat Cole', 'Dot Dunn']),
    ...sheet(3, ['Ann Able', 'Cat Cole', 'Eve Ely']),
  ];

  it('finds the only unaccounted name in all their games, then eliminates it for others', () => {
    const s = suggestWithheldNames(appearances, pitchero, ['Ann Able', 'Bea Best']);
    // Player 10 played all three: only Cat Cole is on every sheet unaccounted for.
    expect(s.get(10)![0]).toEqual({ name: 'Cat Cole', games: 3, of: 3 });
    // Player 11 could be Cat or Dot from their own games; Cat is taken, so Dot.
    expect(s.get(11)![0]).toEqual({ name: 'Dot Dunn', games: 2, of: 2 });
  });

  it('leaves out unused subs, who did not play', () => {
    const withSubs = [
      ...pitchero,
      { fixture_id: 1, name: 'Sub Sid', position: null, starter: false },
      { fixture_id: 2, name: 'Sub Sid', position: null, starter: false },
    ];
    const s = suggestWithheldNames(appearances, withSubs, ['Ann Able', 'Bea Best']);
    expect(s.get(11)!.map((x) => x.name)).not.toContain('Sub Sid');
  });

  it('never suggests someone already in the player list', () => {
    const s = suggestWithheldNames(appearances, pitchero, ['Ann Able', 'Bea Best', 'Cat Cole']);
    expect(s.get(10)!.map((x) => x.name)).not.toContain('Cat Cole');
  });
});

describe('suggestPositions', () => {
  it('uses the position a player lines up in most often', () => {
    const apps: Appearance[] = [1, 2, 3].map((f) => ({
      fixture_id: f,
      player_id: 5,
      name: 'Tom Rattle',
      name_withheld: false,
    }));
    const rows = [
      { fixture_id: 1, name: 'Thomas Rattle', position: 'Fullback' },
      { fixture_id: 2, name: 'Thomas Rattle', position: 'Sweeper' },
      { fixture_id: 3, name: 'Thomas Rattle', position: 'Midfield' },
    ];
    expect(suggestPositions(apps, rows)).toEqual([
      { player_id: 5, position: 'DEF', evidence: 'Fullback 1, Sweeper 1, Midfield 1' },
    ]);
  });
});

describe('pickPitcheroMatch', () => {
  const f = (id: string, dateTime: string, opponent: string): PitcheroFixture => ({
    id,
    date: dateTime.slice(0, 10),
    dateTime,
    opponent,
    played: true,
  });
  const list = [
    f('a', '2026-08-22T11:00:00+01:00', 'Culford 7s'),
    f('b', '2026-08-22T14:00:00+01:00', 'Ipswich 7s'),
    f('c', '2026-08-29T13:00:00+01:00', 'Spalding 1'),
  ];

  it('takes the only match that day', () => {
    expect(
      pickPitcheroMatch(
        list,
        { kickoff: '2026-08-29T12:00:00Z', opponent: 'Spalding 1' },
        '2026-08-29',
      )?.id,
    ).toBe('c');
    expect(
      pickPitcheroMatch(list, { kickoff: '2026-09-05T12:00:00Z', opponent: 'X' }, '2026-09-05'),
    ).toBeUndefined();
  });

  it('tells two games on one day apart by opponent, then time', () => {
    expect(
      pickPitcheroMatch(
        list,
        { kickoff: '2026-08-22T10:00:00Z', opponent: 'Ipswich & East Suffolk 7s' },
        '2026-08-22',
      )?.id,
    ).toBe('b');
    expect(
      pickPitcheroMatch(
        list,
        { kickoff: '2026-08-22T13:00:00Z', opponent: 'Tournament' },
        '2026-08-22',
      )?.id,
    ).toBe('b');
    expect(
      pickPitcheroMatch(
        list,
        { kickoff: '2026-08-22T10:00:00Z', opponent: 'Tournament' },
        '2026-08-22',
      )?.id,
    ).toBe('a');
  });

  it('never uses one Pitchero match for two fixtures', () => {
    const used = new Set(['b']);
    expect(
      pickPitcheroMatch(
        list,
        { kickoff: '2026-08-22T13:00:00Z', opponent: 'Ipswich 7s' },
        '2026-08-22',
        used,
      )?.id,
    ).toBe('a');
  });
});
