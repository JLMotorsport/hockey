import {
  blockedBy,
  canUndo,
  dayHeading,
  describe as describeAction,
  groupActions,
  matchesFilter,
  undoLines,
  type LogRow,
  type Names,
} from '@/lib/changeLog';

let nextId = 1;
const row = (r: Partial<LogRow> & Pick<LogRow, 'tx' | 'table_name' | 'op' | 'row_id'>): LogRow => ({
  id: nextId++,
  at: '2026-10-17T13:02:00Z',
  actor: 'amy',
  old_data: null,
  new_data: null,
  undone_at: null,
  undone_by: null,
  ...r,
});

const names: Names = {
  player: (id) => ({ 1: 'H. Garrod', 2: 'M. Cade', 3: 'O. Sillett' })[id],
  side: (id) => ({ 7: 'M2' })[id],
  fixture: (id) => (id === 50 ? { side_id: 7, opponent: 'Ely 2' } : undefined),
  gameweek: (id) => (id === 6 ? 6 : undefined),
  person: (id) => ({ amy: 'Amy Fenn' })[id],
};

describe('change log', () => {
  it('groups rows by action, newest first', () => {
    const rows = [
      row({ tx: 10, table_name: 'players', op: 'update', row_id: '1' }),
      row({ tx: 11, table_name: 'performances', op: 'insert', row_id: '90' }),
      row({ tx: 11, table_name: 'performances', op: 'insert', row_id: '91' }),
    ];
    const actions = groupActions(rows);
    expect(actions.map((a) => [a.tx, a.rows.length])).toEqual([
      [11, 2],
      [10, 1],
    ]);
    expect(actions[0]!.id).toBe(rows[1]!.id); // undo_change() takes the first row of the action
  });

  it('says what a price change did, and what undo puts back', () => {
    const [a] = groupActions([
      row({
        tx: 1,
        table_name: 'players',
        op: 'update',
        row_id: '1',
        old_data: { id: 1, name: 'H. Garrod', price: 60 },
        new_data: { id: 1, name: 'H. Garrod', price: 65 },
      }),
    ]);
    expect(describeAction(a!, names)).toEqual({
      what: "changed H. Garrod's price",
      detail: '6.0m → 6.5m',
    });
    expect(undoLines(a!, names)).toEqual([{ label: 'price', now: '6.5m', back: '6.0m' }]);
    expect(matchesFilter(a!, 'players')).toBe(true);
    expect(matchesFilter(a!, 'matches')).toBe(false);
  });

  it('reads a saved match as one action: score, players, goals, POTM', () => {
    const [a] = groupActions([
      row({
        tx: 2,
        table_name: 'fixtures',
        op: 'update',
        row_id: '50',
        old_data: { id: 50, side_id: 7, opponent: 'Ely 2', goals_for: null, goals_against: null },
        new_data: { id: 50, side_id: 7, opponent: 'Ely 2', goals_for: 2, goals_against: 2 },
      }),
      ...[1, 2, 3].map((p) =>
        row({
          tx: 2,
          table_name: 'performances',
          op: 'insert',
          row_id: String(100 + p),
          new_data: {
            fixture_id: 50,
            player_id: p,
            goals: p === 2 ? 2 : 0,
            player_of_match: p === 2,
          },
        }),
      ),
    ]);
    expect(describeAction(a!, names)).toEqual({
      what: 'saved M2 v Ely 2',
      detail: 'Score 2-2 · 3 players · goals: M. Cade (2) · POTM: M. Cade',
    });
    expect(undoLines(a!, names)).toEqual([
      { label: 'Score', now: '2-2', back: 'No score' },
      { label: 'Players', now: '3', back: 'None' },
      { label: 'Goals', now: 'M. Cade (2)', back: 'None' },
      { label: 'POTM', now: 'M. Cade', back: 'None' },
    ]);
  });

  it('knows when a later change is in the way, until that one is undone', () => {
    const rows = [
      row({ tx: 1, table_name: 'players', op: 'update', row_id: '1' }),
      row({ tx: 2, table_name: 'players', op: 'update', row_id: '2' }),
      row({ tx: 3, table_name: 'players', op: 'update', row_id: '1', at: '2026-10-17T13:31:00Z' }),
    ];
    let actions = groupActions(rows);
    const first = actions.find((a) => a.tx === 1)!;
    expect(blockedBy(first, actions)?.tx).toBe(3);
    expect(
      blockedBy(
        actions.find((a) => a.tx === 2)!,
        actions,
      ),
    ).toBeNull();

    rows[2]!.undone_at = '2026-10-17T14:00:00Z';
    actions = groupActions(rows);
    expect(
      blockedBy(
        actions.find((a) => a.tx === 1)!,
        actions,
      ),
    ).toBeNull();
  });

  it("won't offer to undo an account removal or something already undone", () => {
    const [removed] = groupActions([
      row({
        tx: 4,
        table_name: 'accounts',
        op: 'delete',
        row_id: 'x',
        old_data: { display_name: 'Ben', team_name: 'Ben XI' },
      }),
    ]);
    expect(canUndo(removed!)).toBe(false);
    expect(describeAction(removed!, names)).toEqual({
      what: "removed Ben's account",
      detail: 'Team: Ben XI',
    });
    const [undone] = groupActions([
      row({ tx: 5, table_name: 'players', op: 'update', row_id: '1', undone_at: 'x' }),
    ]);
    expect(canUndo(undone!)).toBe(false);
  });

  it('names the day in UK time', () => {
    const now = new Date('2026-10-17T12:00:00Z');
    expect(dayHeading('2026-10-17T08:00:00Z', now)).toBe('Today');
    expect(dayHeading('2026-10-16T22:30:00Z', now)).toBe('Yesterday');
    // 23:30 UTC on the 16th is 00:30 on the 17th in the UK (BST).
    expect(dayHeading('2026-10-16T23:30:00Z', now)).toBe('Today');
    expect(dayHeading('2026-10-14T12:00:00Z', now)).toBe('Wed 14 Oct');
  });
});
