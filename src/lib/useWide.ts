import { useSyncExternalStore } from 'react';

/** A PC-width screen (Tailwind's lg, 1024px): the two-column layouts. Phones never match. */
const QUERY = '(min-width: 1024px)';

function subscribe(onChange: () => void) {
  const mq = window.matchMedia?.(QUERY);
  mq?.addEventListener('change', onChange);
  return () => mq?.removeEventListener('change', onChange);
}

export function useWide() {
  return useSyncExternalStore(
    subscribe,
    () => Boolean(window.matchMedia?.(QUERY).matches),
    () => false,
  );
}
