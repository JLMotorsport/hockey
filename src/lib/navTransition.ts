import { useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom';

// Page changes as one smooth move instead of a blank-then-redraw: the
// browser's View Transitions API snapshots the old page, React draws the new
// one in the same frame, and CSS (index.css, "Page transitions") animates
// between them. Browsers without it (or with reduced motion on) just change page.

/** forward: deeper in (Home to Pick); back: out again; swap: side to side (Pick and Transfers, tabs). */
export type NavKind = 'forward' | 'back' | 'swap';

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

export function withTransition(kind: NavKind, update: () => void) {
  const doc = document as ViewTransitionDocument;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || reduced) {
    update();
    return;
  }
  document.documentElement.dataset.nav = kind;
  doc.startViewTransition(() => flushSync(update));
}

/** navigate() that animates the page change. */
export function useTransitionNavigate() {
  const navigate = useNavigate();
  return useCallback(
    (to: To, kind: NavKind = 'forward', options?: NavigateOptions) =>
      withTransition(kind, () => {
        navigate(to, options);
        window.scrollTo(0, 0);
      }),
    [navigate],
  );
}

/**
 * onClick for a Link or NavLink: runs the link's own onClick first (which may
 * cancel, e.g. "unsaved changes"), then changes page with a transition.
 */
export function useTransitionClick() {
  const go = useTransitionNavigate();
  return useCallback(
    (to: To, kind: NavKind = 'forward', own?: (e: React.MouseEvent<HTMLAnchorElement>) => void) =>
      (e: React.MouseEvent<HTMLAnchorElement>) => {
        own?.(e);
        // A modifier or middle click opens a new tab as usual.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        go(to, kind);
      },
    [go],
  );
}
