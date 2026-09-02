/**
 * The fragment the browser is actually showing, which is not always the one
 * still in the address bar by the time React can look.
 *
 * Next's App Router snapshots the URL when the document loads and writes that
 * snapshot back with `replaceState` once hydration finishes. A fragment that
 * changed in between is silently overwritten: the back button pressed while the
 * page is still loading, a link followed before it is interactive, a second
 * link opened on a slow phone. The app's own handler runs after hydration, so
 * by then `window.location.hash` reports the restored value and the arrival is
 * lost.
 *
 * The small beforeInteractive script in `layout.tsx` runs before the router and
 * records every real hashchange. This module reads that record; it decides
 * nothing. `navigation.ts` stays a pure translation with no `window` in it.
 */

declare global {
  interface Window {
    /** The last fragment observed before any silent router replacement. */
    __groupEquationExplorerArrival?: string;
    /** Whether React has consumed the initial fragment. */
    __groupEquationExplorerArrivalReady?: boolean;
  }
}

/**
 * Where to route on arrival.
 *
 * A fragment in the address bar is always the truth: it is either the one that
 * survived, or one set since. An empty address bar is only trusted when nothing
 * else was ever observed, because emptiness is exactly what the router's
 * restore leaves behind — the app itself never navigates to an empty fragment,
 * every destination having one of its own.
 */
export function arrivalFragment(): string {
  if (typeof window === 'undefined') return '';
  const fragment = window.__groupEquationExplorerArrival ?? window.location.hash;
  window.__groupEquationExplorerArrivalReady = true;
  return fragment;
}
