/**
 * Where an edition lives in the reader, as a router path (no deploy base, no trailing slash).
 *
 * Since DAILY_SINCE the Pulso publishes one edition a day, always under the `manha` slot, so the
 * slot no longer tells the reader anything the date does not: that edition lives at
 * `/2026-10-09`. The rule keeps the `/<date>/<slot>` form for anything else, because the weekly
 * audio cites stories by the address they had when the episode was produced.
 *
 * Items have no page of their own: an item is an anchor on its edition (`itemAnchor`).
 *
 * Copied on purpose into `scripts/lib/edition-paths.mjs` and `backend/src/edition/paths.ts`, which
 * cannot import this file; `scripts/edition-paths.test.mjs` holds the copies to the same answers.
 * Keep this module free of imports: that test loads it straight from source.
 */

/** First day of the one-edition-a-day journal. */
export const DAILY_SINCE = "2026-10-09";

export function editionPath(calendarDate: string, slot: string): string {
  return slot === "manha" && calendarDate >= DAILY_SINCE ? `/${calendarDate}` : `/${calendarDate}/${slot}`;
}
