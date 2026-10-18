import { clearDraft, draftKey, readDraft, writeDraft } from '@/lib/squadDraft';

function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

describe('unsaved first squad', () => {
  const key = draftKey('u1', 22);
  const all = () => true;

  it('keeps the picks and puts them back', () => {
    const s = memory();
    const draft = { starters: [1, 2, 3], bench: [9, null, null, 10], captain: 2, vice: 3 };
    writeDraft(s, key, draft);
    expect(readDraft(s, key, all)).toEqual(draft);
    clearDraft(s, key);
    expect(readDraft(s, key, all)).toBeNull();
  });

  it('drops players who have gone, and an armband on someone not starting', () => {
    const s = memory();
    writeDraft(s, key, { starters: [1, 2, 3], bench: [3, 9, null, null], captain: 4, vice: 2 });
    expect(readDraft(s, key, (id) => id !== 1)).toEqual({
      starters: [2, 3],
      bench: [null, 9, null, null],
      captain: null,
      vice: 2,
    });
  });

  it('ignores an empty or broken draft', () => {
    const s = memory();
    writeDraft(s, key, {
      starters: [],
      bench: [null, null, null, null],
      captain: null,
      vice: null,
    });
    expect(s.map.size).toBe(0);
    s.setItem(key, '{not json');
    expect(readDraft(s, key, all)).toBeNull();
    s.setItem(key, JSON.stringify({ starters: ['x'], bench: 'y' }));
    expect(readDraft(s, key, all)).toBeNull();
    expect(readDraft(undefined, key, all)).toBeNull();
  });
});
