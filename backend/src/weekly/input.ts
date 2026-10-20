import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SLOTS, type PulsoEdition, type PulsoItem } from "../edition/schema.js";

/**
 * The week as the weekly episode sees it: every story the published editions carried, once.
 *
 * Only published text goes in — `titlePt`, `blurbPt`, `summaryPt` and the digest. Those already
 * survived the edition's gates, so the episode inherits that guarantee instead of reopening the
 * sources. Nothing here reaches the web.
 */

export interface WeeklyStory {
  /** Short reference handed to the models (`s1`, `s2`…); stable within one run. */
  ref: string;
  item: PulsoItem;
  /** Edition where the story first appeared; its page on the site is the citation target. */
  calendarDate: string;
  slot: string;
  /** How many editions carried the same URL. */
  appearances: number;
  /** Whether a digest bullet pointed at it — the edition's own judgment of priority. */
  inDigest: boolean;
  /** Everything the reader saw about the story, joined. This is the evidence for the script. */
  publishedText: string;
}

export interface WeeklyInput {
  weekId: string;
  from: string;
  to: string;
  editionIds: string[];
  /** Digest headlines in order, so the editor sees what each edition led with. */
  headlines: Array<{ calendarDate: string; slot: string; headline: string }>;
  stories: WeeklyStory[];
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** ISO week id (`2026-W40`) of a calendar date. */
export function isoWeekId(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function publishedText(item: PulsoItem, bullets: string[]): string {
  return [item.titlePt, item.title, item.blurbPt, item.summaryPt, ...bullets]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n");
}

/**
 * Loads the seven days starting at `weekStart` (a Monday) from a published editions tree.
 *
 * A URL that ran in several editions becomes one story; the longest published text wins, since
 * later editions often carry the summary the first one did not have yet.
 */
export function loadWeek(editionsDir: string, weekStart: string): WeeklyInput {
  const byUrl = new Map<string, Omit<WeeklyStory, "ref">>();
  const editionIds: string[] = [];
  const headlines: WeeklyInput["headlines"] = [];

  for (let offset = 0; offset < 7; offset += 1) {
    const calendarDate = addDays(weekStart, offset);
    for (const slot of SLOTS) {
      const file = path.join(editionsDir, calendarDate, `${slot}.json`);
      if (!existsSync(file)) continue;
      const edition = JSON.parse(readFileSync(file, "utf8")) as PulsoEdition;
      if (edition.kind === "quiet" || edition.items.length === 0) continue;
      editionIds.push(edition.id);
      headlines.push({ calendarDate, slot, headline: edition.digest.headline });

      for (const item of edition.items) {
        const bullets = edition.digest.bullets.filter((b) => b.url === item.url).map((b) => b.text);
        const text = publishedText(item, bullets);
        const existing = byUrl.get(item.url);
        if (existing) {
          existing.appearances += 1;
          existing.inDigest ||= bullets.length > 0;
          if (text.length > existing.publishedText.length) {
            // Keep the first appearance as the citation, but the richest text as evidence.
            existing.publishedText = text;
            existing.item = { ...existing.item, ...item, id: existing.item.id };
          }
          continue;
        }
        byUrl.set(item.url, {
          item,
          calendarDate,
          slot,
          appearances: 1,
          inDigest: bullets.length > 0,
          publishedText: text,
        });
      }
    }
  }

  const stories = [...byUrl.values()]
    // Stable order for the prompt: priority signals first, then chronology.
    .sort(
      (a, b) =>
        Number(b.inDigest) - Number(a.inDigest) ||
        b.appearances - a.appearances ||
        a.item.publishedAt.localeCompare(b.item.publishedAt)
    )
    .map((story, index) => ({ ...story, ref: `s${index + 1}` }));

  return {
    weekId: isoWeekId(weekStart),
    from: weekStart,
    to: addDays(weekStart, 6),
    editionIds,
    headlines,
    stories,
  };
}
