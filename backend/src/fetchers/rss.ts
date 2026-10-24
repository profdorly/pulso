import Parser from "rss-parser";
import type { NewsItem, Source } from "../types.js";
import { normalizeFeedItem } from "../services/normalize.js";

export const RSS_USER_AGENT =
  "Mozilla/5.0 (compatible; Pulso/0.1; +https://pulso.dorly.com.br/)";

/**
 * Entries read from each feed per run.
 *
 * 50 since the Pulso went to one run a day: two runs read up to 25 entries each, so a feed that
 * publishes more than 25 items in 24 hours would otherwise lose its overflow before the window is
 * even applied. Entries older than the window cost nothing beyond parsing — no model sees them.
 */
export const DEFAULT_MAX_ITEMS = 50;

const DEFAULT_TIMEOUT_MS = 15000;

export interface RssFetchResult {
  sourceId: string;
  items: NewsItem[];
  error?: string;
  /** Entries this feed returned that could not be normalized. */
  skipped?: number;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/xml, text/xml";

/**
 * Escapes ampersands that do not start an entity, outside CDATA sections.
 *
 * Rest of World ships image URLs like `?width=380&dpr=2` raw in attributes, which a strict XML
 * parser rejects ("Invalid character in entity name") — losing the whole feed every day. CDATA is
 * left alone: a `&` there is already literal text, and escaping it would change what readers see.
 */
export function repairBareAmpersands(xml: string): string {
  return xml
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((part, i) =>
      i % 2 === 1 ? part : part.replace(/&(?!(?:[A-Za-z][A-Za-z0-9]*|#[0-9]+|#x[0-9A-Fa-f]+);)/g, "&amp;")
    )
    .join("");
}

/**
 * Downloads the feed with `fetch` instead of `rss-parser`'s `parseURL`.
 *
 * `parseURL` follows a redirect without consuming the redirect's own response, so its socket
 * stays open until the server drops it. Six of our feeds redirect (Guardian, blog.google, Mistral,
 * The Register, SCMP, Sixth Tone), and that kept the kitchen alive for 5 to 10 idle minutes after
 * it had finished, on every run. `fetch` follows redirects itself, and the abort signal bounds the
 * body too, not only the headers.
 */
async function downloadFeed(url: string, timeoutMs: number): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": RSS_USER_AGENT, Accept: FEED_ACCEPT },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Status code ${response.status}`);
  }
  return response.text();
}

async function parseFeed(parser: Parser, xml: string) {
  try {
    return await parser.parseString(xml);
  } catch (err) {
    // Only a feed the strict parser rejected pays for the repair; a valid one is read as is.
    const repaired = repairBareAmpersands(xml);
    if (repaired === xml) throw err;
    return parser.parseString(repaired);
  }
}

export async function fetchRssSource(
  source: Source,
  options?: { maxItems?: number; timeoutMs?: number }
): Promise<RssFetchResult> {
  if (!source.feedUrl) {
    return {
      sourceId: source.id,
      items: [],
      error: `Source ${source.id} has no feedUrl`,
    };
  }

  const maxItems = options?.maxItems ?? DEFAULT_MAX_ITEMS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchedAt = new Date().toISOString();

  try {
    const parser = new Parser();
    const feed = await parseFeed(parser, await downloadFeed(source.feedUrl, timeoutMs));
    const entries = (feed.items ?? []).slice(0, maxItems);
    const items: NewsItem[] = [];
    let skipped = 0;
    let firstFailure: string | undefined;

    for (const entry of entries) {
      // Normalization is isolated per entry on purpose. A single malformed element used to
      // take the whole feed down: `blog.google` emits elements with attributes, which the XML
      // parser turns into `{_: "text", $: {...}}` rather than a string, and the old
      // `stripHtml` called `.replace` on it — losing all 20 items of a working feed to one
      // bad shape. A feed that returns 19 usable items should publish 19.
      try {
        const item = normalizeFeedItem(entry, source, fetchedAt);
        if (item) {
          items.push(item);
        }
      } catch (err) {
        skipped += 1;
        firstFailure ??= errorMessage(err);
      }
    }

    if (skipped === 0) {
      return { sourceId: source.id, items };
    }
    // Reported, not swallowed: a source quietly shedding entries every run is a defect, and
    // it shows up on the health page instead of looking like a slow news day.
    return {
      sourceId: source.id,
      items,
      skipped,
      error: `${skipped} de ${entries.length} itens ilegíveis (${firstFailure ?? "motivo desconhecido"})`,
    };
  } catch (err) {
    return {
      sourceId: source.id,
      items: [],
      error: errorMessage(err),
    };
  }
}

export async function fetchRssSources(
  sources: Source[],
  options?: { maxItems?: number }
): Promise<{ items: NewsItem[]; results: RssFetchResult[] }> {
  const results = await Promise.all(
    sources.map(async (source) => {
      try {
        return await fetchRssSource(source, options);
      } catch (err) {
        return {
          sourceId: source.id,
          items: [] as NewsItem[],
          error: errorMessage(err),
        };
      }
    })
  );

  const seen = new Set<string>();
  const items: NewsItem[] = [];
  for (const result of results) {
    for (const item of result.items) {
      if (seen.has(item.url)) {
        continue;
      }
      seen.add(item.url);
      items.push(item);
    }
  }

  return { items, results };
}
