import type { Db, Repositories } from "../db/index.js";
import type { EditionJobResult } from "../edition/schema.js";
import { calendarDateBrt } from "../edition/timezone.js";

/** Items no feed has shown for this long are forgotten. */
export const NEWS_ITEM_RETENTION_DAYS = 90;

const DAY_MS = 24 * 3_600_000;

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

/**
 * Whether the daily run should capture the model catalogue before the edition.
 *
 * Once per calendar day in Brasília. A catch-up later that day leaves a fresh catalogue alone;
 * a failed capture keeps the previous date, so the next day's run tries again. The reader's
 * "o que mudou" still compares whole weeks, using the baselines kept by runEdition.
 */
export function catalogueDue(lastCapturedAt: string | undefined, now = new Date()): boolean {
  if (!lastCapturedAt) return true;
  const capturedAt = Date.parse(lastCapturedAt);
  if (!Number.isFinite(capturedAt)) return true;
  return calendarDateBrt(new Date(capturedAt)) !== calendarDateBrt(now);
}

/**
 * Whether a job wrote something the site shows: an edition (with news, or the honest empty one
 * `runEdition` writes once the last cover has gone stale) or the catalogue. A run that found
 * nothing new (`unchanged`) leaves the site as it is.
 */
export function shouldPublishSite(result: EditionJobResult): boolean {
  return result.status === "published" || result.status === "partial";
}
