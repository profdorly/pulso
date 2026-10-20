import path from "node:path";
import { fileURLToPath } from "node:url";

// `scripts/edition-paths.test.mjs` loads this file straight from source (Node strips the types),
// so it must not grow relative imports: `./x.js` does not resolve to `x.ts` there.

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function defaultEditionsDir(): string {
  return path.join(repoRoot(), "data", "editions");
}

export function defaultFixturesDir(): string {
  return path.join(repoRoot(), "fixtures", "editions");
}

export function defaultLockPath(): string {
  return path.join(repoRoot(), "data", "edition.lock");
}

export function editionFileName(calendarDate: string, slot: string): string {
  return path.join(calendarDate, `${slot}.json`);
}

/**
 * First day of the one-edition-a-day journal. Copy of `DAILY_SINCE` in
 * `frontend/src/lib/editionPaths.ts`; `scripts/edition-paths.test.mjs` keeps the two in step.
 */
export const DAILY_SINCE = "2026-10-09";

/**
 * Public address of an edition, as recorded in the index (`path`).
 *
 * A `manha` edition from DAILY_SINCE on lives at its date alone (`/2026-10-09/`); every other
 * edition keeps its slot (`/2026-10-08/tarde/`). The data file does not move: `editionFileName`
 * is still `<date>/<slot>.json`.
 */
export function editionPublicPath(calendarDate: string, slot: string): string {
  return slot === "manha" && calendarDate >= DAILY_SINCE
    ? `/${calendarDate}/`
    : `/${calendarDate}/${slot}/`;
}
