import { describe, expect, it } from 'vitest';
import { circleLine, fullPitch, PITCH_WIDTH, projection, teamPitch } from '@/lib/hockeyPitch';

describe('hockey pitch geometry', () => {
  it('draws the shooting circle as two 14.63 m quarter arcs joined by the 3.66 m goal width', () => {
    const pts = circleLine(14.63);
    const first = pts[0]!;
    const [a, b] = [pts[24]!, pts[25]!];
    const last = pts.at(-1)!;
    expect(first[0]).toBeCloseTo(PITCH_WIDTH / 2 - 1.83 - 14.63, 5);
    expect(first[1]).toBeCloseTo(0, 5);
    // the straight top of the D, 14.63 m out, between the posts
    expect(a[1]).toBeCloseTo(14.63, 5);
    expect(b[1]).toBeCloseTo(14.63, 5);
    expect(b[0] - a[0]).toBeCloseTo(3.66, 5);
    expect(last[0]).toBeCloseTo(PITCH_WIDTH / 2 + 1.83 + 14.63, 5);
  });

  it('makes the far end smaller than the near end', () => {
    const p = projection({ width: 300, top: 100, bottom: 400, y0: 0, y1: 91.4, depth: 2 });
    const farWidth = p.at(55, 0)[0] - p.at(0, 0)[0];
    const nearWidth = p.at(55, 91.4)[0] - p.at(0, 91.4)[0];
    expect(nearWidth).toBeCloseTo(300, 5);
    expect(farWidth).toBeCloseTo(150, 5);
    expect(p.at(0, 0)[1]).toBeCloseTo(100, 5);
    expect(p.at(0, 91.4)[1]).toBeCloseTo(400, 5);
  });

  it('draws every line, mark, goal and spot for the whole pitch', () => {
    const d = fullPitch({ width: 340, top: 440, bottom: 738 });
    expect(d.lines).toHaveLength(6); // outline, halfway, two 23s, two circles
    expect(d.goals).toHaveLength(2);
    expect(d.spots).toHaveLength(2);
    expect(d.details.length).toBeGreaterThan(8 + 2 * 10); // 8 backline marks + dashes round both circles
  });

  it('stands the rows on their lines, in order down the screen', () => {
    const d = teamPitch({ width: 366, height: 372, labelRoom: 66 });
    expect(d.rows.GK).toBeLessThan(d.rows.DEF);
    expect(d.rows.DEF).toBeLessThan(d.rows.MID);
    expect(d.rows.MID).toBeLessThan(d.rows.FWD);
    expect(d.rows.FWD).toBeCloseTo(372 - 66, 5); // forwards on the opposition 23
  });

  it('puts the goal line where asked and stripes the grass to the bottom', () => {
    const d = teamPitch({ width: 366, height: 372, labelRoom: 64, pad: 10, top: 46 });
    expect(d.rows.GK).toBeGreaterThanOrEqual(46); // keeper at the goal, under the boards
    expect(d.bands[0]!.y0).toBeCloseTo(46, 5);
    for (let i = 1; i < d.bands.length; i++) {
      expect(d.bands[i]!.y0).toBeCloseTo(d.bands[i - 1]!.y1, 5); // no gaps
      expect(d.bands[i]!.y1).toBeGreaterThan(d.bands[i]!.y0 - 1e-9);
    }
    expect(d.bands.at(-1)!.y1).toBeCloseTo(372, 5);
  });
});
