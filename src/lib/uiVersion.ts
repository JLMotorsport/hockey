import { useSyncExternalStore } from 'react';

// Testing only: V1 is the design as it was on the morning of 6 Oct, V2 the
// FPL-style redesign. Remembered per device; V2 unless switched.
export type UiVersion = 'v1' | 'v2';

const KEY = 'ui-version';
const listeners = new Set<() => void>();

function read(): UiVersion {
  try {
    return localStorage.getItem(KEY) === 'v1' ? 'v1' : 'v2';
  } catch {
    return 'v2';
  }
}

export function setUiVersion(v: UiVersion) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // Private browsing: the switch still works until the page reloads.
  }
  current = v;
  listeners.forEach((l) => l());
}

let current: UiVersion = read();

export function useUiVersion(): UiVersion {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
