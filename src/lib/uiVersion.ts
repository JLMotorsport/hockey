import { useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';

// V2 is the app. V1 (the design on the morning of 6 Oct) and V3 (the new
// look) are kept for the super user to compare: only they can switch, and
// their choice is remembered per device. Everyone else always gets V2.
export type UiVersion = 'v1' | 'v2' | 'v3';
export const UI_VERSIONS: UiVersion[] = ['v1', 'v2', 'v3'];

const KEY = 'ui-version';
const listeners = new Set<() => void>();

function read(): UiVersion {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'v1' || saved === 'v3' ? saved : 'v2';
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
  const chosen = useChosenVersion();
  const { profile } = useAuth();
  return profile?.is_super ? chosen : 'v2';
}

/** Whether this person may switch versions (the super user). */
export function useCanSwitchVersion(): boolean {
  return Boolean(useAuth().profile?.is_super);
}

function useChosenVersion(): UiVersion {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
