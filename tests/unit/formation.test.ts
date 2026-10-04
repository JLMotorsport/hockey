import { formationOf, overflow, pitchRows } from '@/lib/formation';
import type { Position } from '@/lib/scoring';

const p = (position: Position) => ({ position });
const shape = (rows: ReturnType<typeof pitchRows>) =>
  (['GK', 'DEF', 'MID', 'FWD'] as Position[]).map((k) => rows[k].length).join('-');

describe('pitchRows', () => {
  it('lays out an empty squad in the chosen formation', () => {
    expect(shape(pitchRows([]))).toBe('1-4-4-2');
    expect(shape(pitchRows([], '3-5-2'))).toBe('1-3-5-2');
  });

  it('fills picked players first, then empty shirts', () => {
    const rows = pitchRows([p('GK'), p('DEF'), p('FWD')], '4-3-3');
    expect(shape(rows)).toBe('1-4-3-3');
    expect(rows.DEF.filter(Boolean)).toHaveLength(1);
  });

  it('keeps extra players visible after switching formation', () => {
    const rows = pitchRows([...Array(4).fill(p('DEF'))], '3-4-3');
    expect(rows.DEF).toHaveLength(4);
    expect(overflow({ GK: 0, DEF: 4, MID: 0, FWD: 0 }, '3-4-3')).toEqual({ DEF: 1 });
  });

  it('names a squad by its formation', () => {
    expect(formationOf({ GK: 1, DEF: 5, MID: 3, FWD: 2 })).toBe('5-3-2');
  });
});
