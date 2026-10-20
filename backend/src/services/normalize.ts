import { createHash } from "node:crypto";
import type { NewsItem, Source } from "../types.js";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

function parseDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}

export function toIsoDate(value: unknown, fallback?: string): string {
  const now = new Date();
  const parsed = parseDate(value) ?? parseDate(fallback) ?? now;
  const clamped = parsed.getTime() > now.getTime() ? now : parsed;
  return clamped.toISOString();
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = hex ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      if (Number.isFinite(code) && code >= 0) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function asText(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = asText(item);
      if (text) return text;
    }
    return undefined;
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec._ === "string") return rec._;
    if (typeof rec["#"] === "string") return rec["#"];
    if (typeof rec.text === "string") return rec.text;
    if (typeof rec.href === "string") return rec.href;
    if (rec.$ && typeof rec.$ === "object") {
      const href = (rec.$ as { href?: unknown }).href;
      if (typeof href === "string") return href;
    }
  }
  return undefined;
}

export function stripHtml(value: unknown): string | undefined {
  const text = asText(value);
  if (text == null) {
    return undefined;
  }
  const stripped = decodeEntities(text.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > 0 ? stripped : undefined;
}

export function normalizeFeedItem(
  entry: {
    title?: unknown;
    link?: unknown;
    isoDate?: string;
    pubDate?: string;
    creator?: unknown;
    author?: unknown;
    contentSnippet?: unknown;
    content?: unknown;
    summary?: unknown;
  },
  source: Source,
  fetchedAt: string
): NewsItem | null {
  const url = asText(entry.link)?.trim() ?? "";
  const title = stripHtml(entry.title);
  if (!url || !title) {
    return null;
  }

  const author = stripHtml(entry.creator ?? entry.author);
  const summary = stripHtml(entry.contentSnippet ?? entry.summary ?? entry.content);

  const item: NewsItem = {
    id: hashUrl(url),
    sourceId: source.id,
    block: source.block,
    title,
    url,
    tags: [],
    region: source.region,
    publishedAt: toIsoDate(entry.isoDate ?? entry.pubDate, fetchedAt),
    fetchedAt,
  };

  if (author) {
    item.author = author;
  }
  if (summary) {
    item.summary = summary;
  }
  if (source.category === "official-company") {
    item.company = source.name;
  }

  return item;
}
