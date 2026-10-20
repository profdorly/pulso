import type { PulsoItem } from "./schema.js";
import type { PageLinks } from "./verifyLinks.js";

/**
 * Prefers a successfully fetched original over a syndicated copy.
 *
 * Destructive deduplication deliberately accepts one signal only: a cross-host canonical URL
 * that exactly matches another fetched item in this edition. Ordinary outbound links are useful
 * context, but are too common in related coverage to justify deleting a story.
 *
 * When the canonical origin is not readable, the accessible item stays and names that host.
 * Keeping an occasional duplicate is cheaper than removing the only article we could verify.
 */

/** Comparable form of a URL: no protocol, no `www.`, no query, no trailing slash. */
export function urlKey(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const pathname = parsed.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${pathname}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function hostKey(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

export interface OriginResolution {
  /** Items to publish, annotated with what was learned about their origin. */
  items: PulsoItem[];
  /** Replications dropped because a fetched canonical original is in this edition. */
  dropped: Array<{ item: PulsoItem; inFavorOf: string }>;
}

export interface ResolveOriginsInput {
  items: PulsoItem[];
  /** Link signals per successfully fetched item URL, from the verification pass. */
  links: Map<string, PageLinks>;
}

export function resolveOrigins(input: ResolveOriginsInput): OriginResolution {
  const { items, links } = input;
  const byKey = new Map(items.map((item) => [urlKey(item.url), item]));

  /** Item URL -> fetched canonical item URL. */
  const repeats = new Map<string, string>();
  /** Item URL -> canonical host that could not be fetched. */
  const externalOrigin = new Map<string, string>();

  for (const item of items) {
    const canonical = links.get(item.url)?.canonical;
    if (!canonical) continue;

    const target = byKey.get(urlKey(canonical));
    if (target && target.url !== item.url && links.has(target.url)) {
      repeats.set(item.url, target.url);
      continue;
    }

    const host = hostKey(canonical);
    if (host && host !== hostKey(item.url)) externalOrigin.set(item.url, host);
  }

  // Bad canonical metadata can form a two-item cycle. Keep the older article and never drop both.
  for (const [from, to] of [...repeats]) {
    if (repeats.get(to) !== from) continue;
    const fromItem = byKey.get(urlKey(from))!;
    const toItem = byKey.get(urlKey(to))!;
    const fromTime = Date.parse(fromItem.publishedAt);
    const toTime = Date.parse(toItem.publishedAt);
    if (Number.isNaN(fromTime) || Number.isNaN(toTime) || fromTime <= toTime) {
      repeats.delete(from);
    } else {
      repeats.delete(to);
    }
  }

  // Follow canonical chains to the last fetched source. The item bound prevents malformed cycles
  // from looping forever.
  function originOf(url: string): string {
    let current = url;
    for (let step = 0; step < items.length; step += 1) {
      const next = repeats.get(current);
      if (next === undefined || next === current) break;
      current = next;
    }
    return current;
  }

  const dropped: OriginResolution["dropped"] = [];
  const kept: PulsoItem[] = [];

  for (const item of items) {
    const origin = originOf(item.url);
    if (origin !== item.url) {
      dropped.push({ item, inFavorOf: origin });
    } else {
      kept.push(item);
    }
  }

  const corroboration = new Map<string, number>();
  for (const item of items) {
    const origin = originOf(item.url);
    corroboration.set(origin, (corroboration.get(origin) ?? 0) + 1);
  }

  const annotated = kept.map((item) => {
    const next: PulsoItem = { ...item };
    const count = corroboration.get(item.url) ?? 1;
    const origin = externalOrigin.get(item.url);
    if (count > 1) next.corroboration = count;
    if (origin) next.originHost = origin;
    return next;
  });

  return { items: annotated, dropped };
}
