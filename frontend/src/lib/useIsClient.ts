import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * False while prerendering and during hydration, true once the page runs in the browser.
 *
 * For lazy, client-only pieces: rendering a `lazy` component inside Suspense during the
 * prerender leaves an unfinished boundary, and React reports error 419 when hydration has to
 * fall back to client rendering for it. Rendering nothing on both sides first avoids that.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}
