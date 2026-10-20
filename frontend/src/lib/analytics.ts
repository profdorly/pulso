import { GA_MEASUREMENT_ID } from "./siteBase.js";

type Gtag = (command: "event" | "config" | "js" | "set", ...args: unknown[]) => void;

declare global {
  interface Window {
    gtag?: Gtag;
    dataLayer?: unknown[];
  }
}

/**
 * Sends a GA4 event. Page views need no call: every page is its own document, and the gtag
 * bootstrap in `index.html` counts each load.
 *
 * No-op when gtag is missing (SSR, tests, blocked, or a page that ships no script). Must never throw.
 */
export function trackEvent(name: string, params: Record<string, unknown> = {}): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  try {
    window.gtag("event", name, {
      ...params,
      send_to: GA_MEASUREMENT_ID,
    });
  } catch {
    // Analytics must never break the reader.
  }
}
