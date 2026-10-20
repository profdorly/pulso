import type { Db, Repositories } from "../db/index.js";
import type { EditionJobResult } from "../edition/schema.js";
import { calendarDateBrt } from "../edition/timezone.js";

/** Items no feed has shown for this long are forgotten. */
export const NEWS_ITEM_RETENTION_DAYS = 90;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The `fetched_at` before which an item counts as gone from every feed. */
export function retentionCutoff(now = new Date(), days = NEWS_ITEM_RETENTION_DAYS): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

/**
 * Readies the file for upload: forgets stale items, reclaims the space, folds the WAL into the
 * main file and checks it. Returns how many items were forgotten.
 *
 * Forgetting is safe for dedupe: every fetch refreshes `fetched_at` for each URL it saw, terminal
 * or not, and an item that resurfaces after 90 days is far outside any edition's window.
 *
 * The checkpoint comes after VACUUM so the integrity check reads the same bytes that are uploaded.
 */
export function compactState(db: Db, repositories: Repositories, now = new Date()): number {
  const forgotten = repositories.newsItems.pruneNotSeenSince(retentionCutoff(now));
  db.exec("VACUUM");
  db.pragma("wal_checkpoint(TRUNCATE)");
  const check = db.pragma("integrity_check", { simple: true });
  if (check !== "ok") throw new Error(`cozinha corrompida: ${String(check)}`);
  return forgotten;
}

/** Monday in Brasília, from the calendar date there. */
function isMondayBrt(now: Date): boolean {
  const [year, month, day] = calendarDateBrt(now).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 1;
}

/**
 * Whether the daily run should capture the model catalogue before the edition.
 *
 * Once a week, on Monday, so the Monday cover already carries the new numbers and the page's
 * "o que mudou" compares week with week. A second run on Monday (the catch-up, a manual run)
 * finds a fresh catalogue and leaves it alone. A Monday whose capture failed leaves the old
 * catalogue in place, so it is more than a week old by Tuesday, and Tuesday retries.
 */
export function catalogueDue(lastCapturedAt: string | undefined, now = new Date()): boolean {
  if (!lastCapturedAt) return true;
  const age = now.getTime() - Date.parse(lastCapturedAt);
  if (!Number.isFinite(age) || age >= 7 * DAY_MS + 12 * HOUR_MS) return true;
  return isMondayBrt(now) && age >= 12 * HOUR_MS;
}

/**
 * Whether a job wrote something the site shows: an edition (with news, or the honest empty one
 * `runEdition` writes once the last cover has gone stale) or the catalogue. A run that found
 * nothing new (`unchanged`) leaves the site as it is.
 */
export function shouldPublishSite(result: EditionJobResult): boolean {
  return result.status === "published" || result.status === "partial";
}
