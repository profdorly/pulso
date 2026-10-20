import { useEffect } from "react";

const ROBOTS_SELECTOR = 'meta[name="robots"][data-pulso-noindex="true"]';

/**
 * Marks the current view as `noindex` while it is mounted.
 *
 * A client-rendered router cannot return a 404 status, so an error view that stays
 * indexable becomes a soft 404. Google's JavaScript SEO guidance is to inject a
 * robots `noindex` tag on those views instead.
 */
export function useNoindex(active = true): void {
  useEffect(() => {
    if (!active) return;

    const existing = document.querySelector(ROBOTS_SELECTOR);
    if (existing) return;

    const meta = document.createElement("meta");
    meta.setAttribute("name", "robots");
    meta.setAttribute("content", "noindex");
    meta.setAttribute("data-pulso-noindex", "true");
    document.head.appendChild(meta);

    return () => {
      meta.remove();
    };
  }, [active]);
}
