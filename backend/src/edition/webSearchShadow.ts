import type { WebSearchCandidate, WebSearchResult } from "../fetchers/webSearch.js";
import { hashUrl } from "../services/normalize.js";
import type { TokenUsage } from "./cost.js";
import type { PulsoItem } from "./schema.js";
import { calendarDateBrt } from "./timezone.js";
import type { VerifyLinksResult } from "./verifyLinks.js";
import type { WorkerResult } from "./worker.js";

/**
 * Shadow mode for the web search beyond the feeds.
 *
 * The search runs every edition and each result goes through the checks it would face as a real
 * candidate — already known, link, publication date, theme — but nothing is published: the
 * outcome is one JSON line in the run log. A week of those lines answers what a single test day
 * could not, before the search is allowed onto the cover: how many stories a day it really adds,
 * from where, and at what cost.
 *
 * Read them with:
 *   aws logs filter-log-events --log-group-name /aws/lambda/pulso-publisher-staging \
 *     --filter-pattern '"pulso-web-search-shadow"'
 */

export type WebSearchMode = "off" | "shadow";

export function webSearchMode(value: string | undefined): WebSearchMode {
  return value?.trim().toLowerCase() === "shadow" ? "shadow" : "off";
}

/** Timestamps a little before the window still count: pages round, and sometimes lie by an hour. */
const WINDOW_SLACK_MS = 2 * 60 * 60 * 1000;

/**
 * Whether a page's stated date falls inside the edition window. A day-only date ("2026-10-09")
 * counts from the São Paulo day the window started on, since the hour is unknown.
 */
export function publishedWithin(publishedAt: string, windowStart: Date): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) return publishedAt >= calendarDateBrt(windowStart);
  const parsed = Date.parse(publishedAt);
  return !Number.isNaN(parsed) && parsed >= windowStart.getTime() - WINDOW_SLACK_MS;
}

/** Origin and path, without query or trailing slash: the same article behind two tracking URLs. */
export function urlKey(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/$/, "") : parsed.pathname;
    return `${parsed.hostname.replace(/^www\./, "").toLowerCase()}${path}`;
  } catch {
    return url;
  }
}

export type ShadowRejectionReason =
  | "ja-conhecida"
  | "link"
  | "sem-data"
  | "fora-da-janela"
  | "fora-do-tema";

export interface ShadowReport {
  type: "pulso-web-search-shadow";
  window: { start: string; end: string };
  model: string;
  searches: number;
  queries: string[];
  errors: string[];
  candidates: number;
  /** Results that passed every check and would have competed for a slot. */
  wouldAdd: Array<{
    title: string;
    url: string;
    outlet: string;
    region: string;
    language: string;
    publishedAt: string;
    searchRegion: string;
    why: string;
  }>;
  counts: Record<ShadowRejectionReason, number>;
  rejected: Array<{ url: string; outlet: string; reason: ShadowRejectionReason; detail?: string }>;
}

export interface ShadowEvaluationInput {
  search: WebSearchResult;
  windowStart: Date;
  windowEnd: Date;
  model: string;
  /** True for a URL the feeds or an earlier run already brought. */
  isKnown: (url: string) => boolean;
  verifyLinks: (items: PulsoItem[]) => Promise<VerifyLinksResult>;
  classify: (items: PulsoItem[]) => Promise<WorkerResult>;
}

function asItem(candidate: WebSearchCandidate, kind: PulsoItem["kind"], seenAt: string): PulsoItem {
  return {
    id: hashUrl(candidate.url),
    title: candidate.title,
    url: candidate.url,
    outlet: candidate.outlet,
    // Shadow items never reach selection, so the quota region does not matter here; the report
    // keeps the model's own label for the regional breakdown.
    region: "us",
    // Discovery for the link check: no bot-block leniency, so the page itself must open.
    kind,
    genre: "news",
    publishedAt: candidate.publishedAt,
    firstSeenAt: seenAt,
  };
}

export async function evaluateShadowSearch(
  input: ShadowEvaluationInput
): Promise<{ report: ShadowReport; classifyUsage?: TokenUsage }> {
  const counts: ShadowReport["counts"] = {
    "ja-conhecida": 0,
    link: 0,
    "sem-data": 0,
    "fora-da-janela": 0,
    "fora-do-tema": 0,
  };
  const rejected: ShadowReport["rejected"] = [];
  const reject = (candidate: WebSearchCandidate, reason: ShadowRejectionReason, detail?: string) => {
    counts[reason] += 1;
    rejected.push({ url: candidate.url, outlet: candidate.outlet, reason, ...(detail ? { detail } : {}) });
  };

  const fresh = input.search.candidates.filter((candidate) => {
    if (!input.isKnown(candidate.url)) return true;
    reject(candidate, "ja-conhecida");
    return false;
  });

  const seenAt = input.windowEnd.toISOString();
  const byUrl = new Map(fresh.map((candidate) => [candidate.url, candidate]));
  const checked =
    fresh.length > 0
      ? await input.verifyLinks(fresh.map((candidate) => asItem(candidate, "discovery", seenAt)))
      : { items: [], dropped: [] };
  for (const drop of checked.dropped) {
    const candidate = byUrl.get(drop.item.url);
    if (candidate) reject(candidate, "link", drop.reason);
  }

  const dated: WebSearchCandidate[] = [];
  const pageDates = new Map<string, string>();
  for (const item of checked.items) {
    const candidate = byUrl.get(item.url);
    if (!candidate) continue;
    const publishedAt = checked.dates?.get(item.url);
    if (!publishedAt) {
      reject(candidate, "sem-data");
    } else if (!publishedWithin(publishedAt, input.windowStart)) {
      reject(candidate, "fora-da-janela", publishedAt);
    } else {
      pageDates.set(candidate.url, publishedAt);
      dated.push(candidate);
    }
  }

  // The same theme rule as broad press: only what is about AI, and silence is not a yes.
  const classified =
    dated.length > 0 ? await input.classify(dated.map((candidate) => asItem(candidate, "press", seenAt))) : undefined;
  const kept = new Set(classified?.items.map((item) => item.url) ?? []);
  const wouldAdd: ShadowReport["wouldAdd"] = [];
  for (const candidate of dated) {
    if (!kept.has(candidate.url)) {
      reject(candidate, "fora-do-tema");
      continue;
    }
    wouldAdd.push({
      title: candidate.title,
      url: candidate.url,
      outlet: candidate.outlet,
      region: candidate.region,
      language: candidate.language,
      publishedAt: pageDates.get(candidate.url) ?? candidate.publishedAt,
      searchRegion: candidate.searchRegion,
      why: candidate.why,
    });
  }

  return {
    report: {
      type: "pulso-web-search-shadow",
      window: { start: input.windowStart.toISOString(), end: input.windowEnd.toISOString() },
      model: input.model,
      searches: input.search.usage?.webSearchCalls ?? 0,
      queries: input.search.queries,
      errors: input.search.errors,
      candidates: input.search.candidates.length,
      wouldAdd,
      counts,
      rejected,
    },
    ...(classified?.usage ? { classifyUsage: classified.usage } : {}),
  };
}
