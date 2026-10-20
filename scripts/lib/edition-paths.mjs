/**
 * The edition URL rule, for the scripts that do not load the SSR bundle.
 *
 * A copy of `frontend/src/lib/editionPaths.ts` (see there for the why). It is duplicated rather
 * than imported because `slice-public-editions.mjs` runs before the reader is built, and
 * `verify-site.mjs` and `a11y.mjs` are there to check the build, not to trust it.
 * `scripts/edition-paths.test.mjs` fails as soon as this copy, the TypeScript helper and
 * `editionPublicPath` in `backend/src/edition/paths.ts` disagree.
 */

/** First day of the one-edition-a-day journal. */
export const DAILY_SINCE = "2026-10-09";

/** Router path of an edition: `/2026-10-09` for a daily edition, `/<date>/<slot>` otherwise. */
export function editionPath(calendarDate, slot) {
  return slot === "manha" && calendarDate >= DAILY_SINCE ? `/${calendarDate}` : `/${calendarDate}/${slot}`;
}

/** The `path` field of `index.json`: the public address, with the trailing slash a static host serves. */
export function editionPublicPath(calendarDate, slot) {
  return `${editionPath(calendarDate, slot)}/`;
}
