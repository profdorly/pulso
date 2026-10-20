import { SOURCES } from "../config/sources.js";
import { RSS_USER_AGENT } from "../fetchers/rss.js";
import { stripHtml } from "../services/normalize.js";
import type { Source } from "../types.js";
import { BlockedUrlError, guardedFetch, type UrlGuardOptions } from "./safeFetch.js";
import type { PulsoItem } from "./schema.js";

export const LINK_TIMEOUT_MS = 10_000;
export const LINK_CONCURRENCY = 6;
const BODY_LIMIT = 200_000;

function streamChunk(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array();
}

function readStreamResult(result: unknown): { done: boolean; value?: unknown } {
  if (typeof result !== "object" || result === null) return { done: true };
  const record = result as { done?: unknown; value?: unknown };
  return { done: Boolean(record.done), value: record.value };
}

/**
 * Reads a response body up to `limit` bytes and cancels the rest.
 *
 * `response.text()` would buffer the entire payload first. A feed that pointed at a
 * multi-gigabyte file would exhaust memory before the slice ran.
 */
export async function readLimitedText(response: Response, limit: number): Promise<string> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    return text.length > limit ? text.slice(0, limit) : text;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    while (received < limit) {
      const { done, value } = readStreamResult(await reader.read());
      if (done) break;
      const bytes = streamChunk(value);
      if (bytes.byteLength === 0) continue;
      const remaining = limit - received;
      const chunk = bytes.byteLength > remaining ? bytes.subarray(0, remaining) : bytes;
      text += decoder.decode(chunk, { stream: true });
      received += chunk.byteLength;
      if (bytes.byteLength > remaining) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Already closed.
    }
  }
  return text + decoder.decode();
}

const LISTING_SEGMENTS = new Set([
  "news",
  "blog",
  "feed",
  "rss",
  "category",
  "tag",
  "tags",
  "topic",
  "topics",
  "index",
]);

const STOP = new Set([
  "para",
  "como",
  "que",
  "uma",
  "com",
  "por",
  "dos",
  "das",
  "the",
  "and",
  "for",
  "from",
  "with",
  "this",
  "that",
  "nao",
  "mais",
  "sobre",
  "apos",
  "depois",
  "entre",
  "pelo",
  "pela",
  "onde",
  "quando",
  "our",
  "its",
  "has",
  "was",
  "are",
  "been",
  "into",
  "your",
  "their",
  "about",
  "after",
  "before",
  "http",
  "https",
  "www",
  "html",
  // Hindi function words long enough to pass the length rule ("did", "for doing", "will be"…).
  "किया",
  "करने",
  "करेगा",
  "करेगी",
  "होगा",
  "होगी",
  "द्वारा",
  "अपने",
  "अपनी",
]);

const SOFT_404 =
  /p[aá]gina n[aã]o encontrada|n[aã]o encontrad[oa]|not found|page not found|erro 404|error 404|conte[uú]do (indispon[ií]vel|n[aã]o exist)/i;

export type LinkDropReason =
  | "not-found"
  | "http-error"
  | "network"
  | "homepage"
  | "soft-404"
  | "title-mismatch"
  | "host-mismatch"
  | "blocked"
  | "unsafe-target";

export interface LinkCheck {
  item: PulsoItem;
  ok: boolean;
  status?: number;
  finalUrl?: string;
  reason?: LinkDropReason;
  /**
   * Plain text of the fetched page, kept so the evidence gate can check claims without
   * downloading anything a second time.
   */
  evidence?: string;
  /** Canonical and outbound links from the same fetch, for origin detection. */
  links?: PageLinks;
  /**
   * When the page says it was published: an ISO timestamp, or `YYYY-MM-DD` when the page only
   * gives a day. Undefined when the page states no date.
   */
  publishedAt?: string;
}

export interface VerifyLinksResult {
  items: PulsoItem[];
  dropped: LinkCheck[];
  /**
   * Page text per item URL, for the evidence gate. Optional so a caller that only cares
   * about reachability can return a simpler result.
   */
  evidence?: Map<string, string>;
  /** Link signals per item URL, for deciding which member of a story is the original. */
  links?: Map<string, PageLinks>;
  /** Publication date stated by each page that states one; see LinkCheck.publishedAt. */
  dates?: Map<string, string>;
}

const PUBLISHED_PATTERNS: RegExp[] = [
  /<meta[^>]+property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']article:published_time["']/i,
  /"datePublished"\s*:\s*"([^"]+)"/i,
  /<meta[^>]+itemprop=["']datePublished["'][^>]*content=["']([^"']+)["']/i,
  /<meta[^>]+name=["'](?:pubdate|publishdate|publish-date|date|dc\.date|dc\.date\.issued|parsely-pub-date|sailthru\.date|article\.published)["'][^>]*content=["']([^"']+)["']/i,
  /<time[^>]+datetime=["']([^"']+)["']/i,
];

/** `/2026/10/09/` or `2026-10-09` in a URL path: day precision, the least specific signal. */
const URL_DATE = /(?:^|[/_-])(20\d{2})[/-](0[1-9]|1[0-2])[/-](0[1-9]|[12]\d|3[01])(?=$|[/_.-])/;

function normalizedDate(raw: string): string | undefined {
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

/**
 * The publication date a page states about itself, from the markup publishers use for it
 * (Open Graph, schema.org, the usual meta names, a `<time>` element), then from a date in the
 * URL path. A web-search result is only as fresh as the page says it is: the model's own date
 * for it is not evidence.
 */
export function extractPublishedAt(html: string, url: string): string | undefined {
  for (const pattern of PUBLISHED_PATTERNS) {
    const match = pattern.exec(html);
    const date = match ? normalizedDate(match[1]) : undefined;
    if (date) return date;
  }
  try {
    const match = URL_DATE.exec(new URL(url).pathname);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  } catch {
    // Not a URL: no date to read from it.
  }
  return undefined;
}

export interface VerifyLinksOptions {
  fetch?: typeof fetch;
  sources?: Source[];
  timeoutMs?: number;
  /** Injected DNS resolver for the SSRF guard; defaults to real DNS. */
  lookup?: UrlGuardOptions["lookup"];
  /** Test escape hatch: skip DNS resolution but keep protocol/host/IP checks. */
  skipDnsCheck?: boolean;
}

function fold(value: string): string {
  return value
    .normalize("NFKC")
    .normalize("NFD")
    // Accents off Latin letters only: in kana or Hangul the combining marks are part of the letter.
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase();
}

/**
 * Scripts compared by pairs of letters instead of whole words: those written without spaces
 * (Chinese, Japanese, Thai, Lao, Khmer, Burmese), and Hangul, whose words carry their particles
 * and endings ("반도체" and "반도체를" are the same word to a reader, not to an equality test).
 */
const PAIRED = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\p{Script=Thai}\\p{Script=Lao}\\p{Script=Khmer}\\p{Script=Myanmar}";
const PAIRED_CHAR = new RegExp(`[${PAIRED}]`, "u");
// Marks (vowel signs, viramas, tone marks) belong to the letter before them: without them in the
// class, a Devanagari or Thai word falls apart into fragments generic enough to match any page.
const PAIRED_RUNS = new RegExp(`[${PAIRED}ー\\p{M}]+|[^${PAIRED}ー]+`, "gu");
const WORD = /[\p{L}\p{M}\p{N}ー]+/gu;

function wordTokens(word: string): string[] {
  // One rule for every spaced script: four characters or more (a vowel sign counts), minus stop
  // words. Short words are particles and generic terms in Arabic and Devanagari as much as "new"
  // and "AI" are in English.
  return word.length >= 4 && !STOP.has(word) ? [word] : [];
}

/**
 * The comparable pieces of a title or page. Before this handled scripts other than Latin, a
 * Chinese, Japanese or Arabic headline folded to nothing and could never match its own page:
 * every web-search lead from those newsrooms was dropped as a title mismatch.
 */
function tokens(value: string): string[] {
  const out: string[] = [];
  for (const word of fold(value).match(WORD) ?? []) {
    if (!PAIRED_CHAR.test(word)) {
      out.push(...wordTokens(word));
      continue;
    }
    for (const run of word.match(PAIRED_RUNS) ?? []) {
      if (!PAIRED_CHAR.test(run)) {
        out.push(...wordTokens(run));
        continue;
      }
      // Pairs of letters, each letter with its marks.
      const letters = run.match(/[^\p{M}]\p{M}*/gu) ?? [];
      for (let i = 0; i < letters.length - 1; i += 1) out.push(letters[i] + letters[i + 1]);
    }
  }
  return out;
}

export function titleMatches(itemTitle: string, pageText: string): boolean {
  const wanted = tokens(itemTitle);
  if (wanted.length === 0) {
    const needle = fold(itemTitle).replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
    return needle.length >= 8 && fold(pageText).replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").includes(needle);
  }
  const page = new Set(tokens(pageText));
  const hits = wanted.filter((token) => page.has(token));
  const need = wanted.length <= 3 ? Math.min(2, wanted.length) : Math.ceil(wanted.length * 0.4);
  return hits.length >= need;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

export function hostsRelated(left: string, right: string): boolean {
  const a = left.replace(/^www\./, "").toLowerCase();
  const b = right.replace(/^www\./, "").toLowerCase();
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function isListingUrl(url: string): boolean {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts.length === 0) return true;
    if (parts.length === 1 && LISTING_SEGMENTS.has(parts[0]?.toLowerCase() ?? "")) return true;
    return false;
  } catch {
    return true;
  }
}

function sourceFor(item: PulsoItem, sources: Source[]): Source | undefined {
  const byName = sources.find((source) => source.name === item.outlet);
  if (byName) return byName;
  const host = hostOf(item.url);
  if (!host) return undefined;
  return sources.find((source) => {
    const home = hostOf(source.homepage);
    return home ? hostsRelated(host, home) : false;
  });
}

function extractPageText(html: string): string {
  const title = stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") ?? "";
  const og = stripHtml(html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1]
    ?? html.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i)?.[1]
    ?? "") ?? "";
  const h1 = stripHtml(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "") ?? "";
  return [title, og, h1].filter(Boolean).join(" \n ");
}

/**
 * Structured signals from the fetched markup.
 *
 * `extractEvidenceText` strips every tag, which threw away the two most precise indicators of
 * syndication: the canonical link and the outbound article links. The body was already
 * downloaded, so keeping them costs nothing beyond the parse.
 */
export interface PageLinks {
  /** Declared canonical, absolute. Present only when it points at another host. */
  canonical?: string;
  /** Article-looking links to other hosts, capped and deduped. */
  outbound: string[];
}

/** Enough to catch an attribution link; a page with hundreds of links is a listing. */
const OUTBOUND_LIMIT = 60;

export function extractPageLinks(html: string, pageUrl: string): PageLinks {
  const pageHost = hostOf(pageUrl);
  const links: PageLinks = { outbound: [] };

  for (const tag of html.match(/<link[^>]+>/gi) ?? []) {
    if (!/rel=["']?canonical/i.test(tag)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    try {
      const absolute = new URL(href, pageUrl).href;
      // Only interesting when it leaves the host: a self-canonical says nothing about origin.
      if (hostOf(absolute) !== pageHost) links.canonical = absolute;
    } catch {
      // Unusable href, ignore.
    }
    break;
  }

  const seen = new Set<string>();
  for (const tag of html.match(/<a\s[^>]*href=["'][^"']+["'][^>]*>/gi) ?? []) {
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    if (/^(?:#|mailto:|javascript:|tel:)/i.test(href)) continue;
    let absolute: string;
    try {
      absolute = new URL(href, pageUrl).href;
    } catch {
      continue;
    }
    const host = hostOf(absolute);
    if (!host || host === pageHost) continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    links.outbound.push(absolute);
    if (links.outbound.length >= OUTBOUND_LIMIT) break;
  }

  return links;
}

/** Cap on the plain-text body kept as evidence for the claim gate. */
export const EVIDENCE_LIMIT = 40_000;

/**
 * Readable body text, used as evidence for the claim gate.
 *
 * Script and style blocks are removed first so their contents cannot be mistaken for
 * article numbers.
 */
export function extractEvidenceText(html: string): string {
  const withoutCode = html
    // End tags may carry whitespace before the ">" (`</script >`), and HTML is case-insensitive.
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, " ");
  const text = stripHtml(withoutCode) ?? "";
  return text.length > EVIDENCE_LIMIT ? text.slice(0, EVIDENCE_LIMIT) : text;
}

function isHtml(contentType: string | null): boolean {
  if (!contentType) return true;
  return /html|xml|text\/plain/i.test(contentType);
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function probe(
  item: PulsoItem,
  options: Required<Pick<VerifyLinksOptions, "timeoutMs">> & {
    fetch: typeof fetch;
    sources: Source[];
    lookup?: UrlGuardOptions["lookup"];
    skipDnsCheck?: boolean;
  }
): Promise<LinkCheck> {
  const source = sourceFor(item, options.sources);
  const expectedHost = source ? hostOf(source.homepage) : undefined;
  const itemHost = hostOf(item.url);
  if (expectedHost && itemHost && !hostsRelated(itemHost, expectedHost)) {
    return { item, ok: false, reason: "host-mismatch" };
  }

  try {
    const { response, finalUrl: resolvedUrl } = await guardedFetch(
      item.url,
      {
        method: "GET",
        headers: {
          "User-Agent": RSS_USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(options.timeoutMs),
      },
      { fetch: options.fetch, lookup: options.lookup, skipDnsCheck: options.skipDnsCheck }
    );
    const finalUrl = resolvedUrl || item.url;
    const status = response.status;

    if (status === 404 || status === 410) {
      return { item, ok: false, status, finalUrl, reason: "not-found" };
    }
    if (status === 401 || status === 403 || status === 429) {
      if (item.kind !== "discovery" && expectedHost && itemHost && hostsRelated(itemHost, expectedHost)) {
        return { item, ok: true, status, finalUrl };
      }
      return { item, ok: false, status, finalUrl, reason: "blocked" };
    }
    if (status < 200 || status >= 400) {
      return { item, ok: false, status, finalUrl, reason: "http-error" };
    }
    if (isListingUrl(finalUrl) || isListingUrl(item.url)) {
      return { item, ok: false, status, finalUrl, reason: "homepage" };
    }
    if (!isHtml(response.headers.get("content-type"))) {
      return { item, ok: false, status, finalUrl, reason: "http-error" };
    }

    const raw = await readLimitedText(response, BODY_LIMIT);
    const html = raw;
    const pageText = extractPageText(html);
    if (SOFT_404.test(pageText)) {
      return { item, ok: false, status, finalUrl, reason: "soft-404" };
    }
    if (!titleMatches(item.title, pageText)) {
      return { item, ok: false, status, finalUrl, reason: "title-mismatch" };
    }
    const publishedAt = extractPublishedAt(html, finalUrl ?? item.url);
    return {
      item,
      ok: true,
      status,
      finalUrl,
      evidence: extractEvidenceText(html),
      links: extractPageLinks(html, finalUrl ?? item.url),
      ...(publishedAt ? { publishedAt } : {}),
    };
  } catch (error) {
    // A blocked target is a property of the URL, not of the network: never retry it.
    if (error instanceof BlockedUrlError) {
      return { item, ok: false, reason: "unsafe-target" };
    }
    return { item, ok: false, reason: "network" };
  }
}

export async function verifyEditionLinks(
  items: PulsoItem[],
  options: VerifyLinksOptions = {}
): Promise<VerifyLinksResult> {
  if (items.length === 0) {
    return { items: [], dropped: [], evidence: new Map(), links: new Map() };
  }

  const checks = await mapPool(items, LINK_CONCURRENCY, (item) =>
    probe(item, {
      fetch: options.fetch ?? fetch,
      sources: options.sources ?? SOURCES,
      timeoutMs: options.timeoutMs ?? LINK_TIMEOUT_MS,
      lookup: options.lookup,
      skipDnsCheck: options.skipDnsCheck,
    })
  );

  const evidence = new Map<string, string>();
  const links = new Map<string, PageLinks>();
  const dates = new Map<string, string>();
  for (const check of checks) {
    if (!check.ok) continue;
    if (check.evidence) evidence.set(check.item.url, check.evidence);
    if (check.links) links.set(check.item.url, check.links);
    if (check.publishedAt) dates.set(check.item.url, check.publishedAt);
  }

  return {
    items: checks.filter((check) => check.ok).map((check) => check.item),
    dropped: checks.filter((check) => !check.ok),
    evidence,
    links,
    dates,
  };
}
