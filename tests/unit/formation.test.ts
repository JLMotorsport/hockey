import { pitchRows } from '@/lib/formation';
import type { Position } from '@/lib/scoring';

const p = (position: Position) => ({ position });
const shape = (rows: ReturnType<typeof pitchRows>) =>
  (['GK', 'DEF', 'MID', 'FWD'] as Position[]).map((k) => rows[k].length).join('-');

describe('pitchRows', () => {
  it('shows an empty squad as 1-4-4-2', () => {
    expect(shape(pitchRows([]))).toBe('1-4-4-2');
  });

  it('keeps a picked 5-3-2 and leaves no extra slots', () => {
    const squad = [
      p('GK'),
      ...Array(5).fill(p('DEF')),
      ...Array(3).fill(p('MID')),
      p('FWD'),
      p('FWD'),
    ];
    const rows = pitchRows(squad);
    expect(shape(rows)).toBe('1-5-3-2');
    expect(
      Object.values(rows)
        .flat()
        .filter((x) => x === null),
    ).toHaveLength(0);
  });

  it('reserves slots for missing minimums first', () => {
    // 6 DEF and 2 MID picked, 3 slots left: GK, a MID, a FWD.
    const rows = pitchRows([...Array(6).fill(p('DEF')), p('MID'), p('MID')]);
    expect(shape(rows)).toBe('1-6-3-1');
  });

  it('adds no empty slots once the squad is full', () => {
    const rows = pitchRows(Array(12).fill(p('MID')));
    expect(Object.values(rows).flat()).toHaveLength(12);
    expect(rows.GK).toEqual([]);
  });
});
