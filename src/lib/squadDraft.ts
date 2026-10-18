// A first squad picked but not saved yet, kept on this device so closing
// the page doesn't lose it. Only what's needed to put the picks back;
// nothing counts until save_squad() accepts it.

export interface SquadDraft {
  starters: number[];
  /** [sub keeper, sub 1, sub 2, sub 3], null where empty. */
  bench: (number | null)[];
  captain: number | null;
  vice: number | null;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const draftKey = (userId: string, gameweekId: number) =>
  `squad-draft:${userId}:${gameweekId}`;

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * The draft saved under `key`, keeping only players that still exist
 * (`known`). Null when there isn't one worth putting back.
 */
export function readDraft(
  storage: Storage | undefined,
  key: string,
  known: (id: number) => boolean,
): SquadDraft | null {
  let raw: unknown;
  try {
    raw = JSON.parse(storage?.getItem(key) ?? 'null');
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const starters = (Array.isArray(d.starters) ? d.starters : []).filter(isId).filter(known);
  const bench = Array.from({ length: 4 }, (_, i) => {
    const id = Array.isArray(d.bench) ? (d.bench[i] as unknown) : null;
    return isId(id) && known(id) && !starters.includes(id) ? id : null;
  });
  if (!starters.length && bench.every((b) => b === null)) return null;
  const armband = (v: unknown) => (isId(v) && starters.includes(v) ? v : null);
  return { starters, bench, captain: armband(d.captain), vice: armband(d.vice) };
}

export function writeDraft(storage: Storage | undefined, key: string, draft: SquadDraft): void {
  try {
    if (!draft.starters.length && draft.bench.every((b) => b === null)) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(draft));
  } catch {
    // Private browsing or full storage: it just isn't kept.
  }
}

export function clearDraft(storage: Storage | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // As above.
  }
}

/** localStorage, or nothing where it can't be reached. */
export function deviceStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
