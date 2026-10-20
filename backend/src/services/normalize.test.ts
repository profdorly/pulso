import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Source } from "../types.js";
import { hashUrl, normalizeFeedItem, stripHtml, toIsoDate } from "./normalize.js";

const fetchedAt = "2026-08-14T12:00:00.000Z";

const officialSource: Source = {
  id: "openai-news",
  name: "OpenAI News",
  type: "rss",
  category: "official-company",
  region: "us",
  feedUrl: "https://openai.com/news/rss.xml",
  homepage: "https://openai.com/news",
  block: "official",
};

const impartialSource: Source = {
  id: "the-verge-ai",
  name: "The Verge — AI",
  type: "rss",
  category: "impartial-media",
  region: "us",
  feedUrl: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
  homepage: "https://www.theverge.com/ai-artificial-intelligence",
  block: "impartial",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("hashUrl", () => {
  it("returns a stable sha256 hex digest", () => {
    const url = "https://example.com/post";
    const expected = createHash("sha256").update(url).digest("hex");
    expect(hashUrl(url)).toBe(expected);
    expect(hashUrl(url)).toBe(hashUrl(url));
    expect(hashUrl(url)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different hashes for different urls", () => {
    expect(hashUrl("https://example.com/a")).not.toBe(hashUrl("https://example.com/b"));
  });
});

describe("toIsoDate", () => {
  it("parses RSS pubDate and isoDate into ISO 8601", () => {
    expect(toIsoDate("Thu, 13 Aug 2026 16:00:00 GMT")).toBe("2026-08-13T16:00:00.000Z");
    expect(toIsoDate("2026-08-13T16:00:00.000Z")).toBe("2026-08-13T16:00:00.000Z");
  });

  it("uses fallback or now when the value is unparseable", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00.000Z"));
    expect(toIsoDate("not-a-date", fetchedAt)).toBe(fetchedAt);
    expect(toIsoDate(undefined)).toBe("2026-08-14T12:00:00.000Z");
    expect(toIsoDate(null)).toBe("2026-08-14T12:00:00.000Z");
  });

  it("clamps future dates to now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00.000Z"));
    expect(toIsoDate("2099-01-01T00:00:00.000Z")).toBe("2026-08-14T12:00:00.000Z");
    expect(toIsoDate("Thu, 01 Jan 2099 00:00:00 GMT", fetchedAt)).toBe(
      "2026-08-14T12:00:00.000Z"
    );
  });
});

describe("stripHtml", () => {
  it("strips tags, decodes entities, and trims", () => {
    expect(stripHtml("  <p>Hello &amp; <b>world</b></p>  ")).toBe("Hello & world");
    expect(stripHtml("A &lt; B &gt; C")).toBe("A < B > C");
    expect(stripHtml("&quot;quoted&quot; &#39;apos&#39;")).toBe(`"quoted" 'apos'`);
  });

  it("returns undefined for empty, missing, or tag-only values", () => {
    expect(stripHtml(undefined)).toBeUndefined();
    expect(stripHtml("")).toBeUndefined();
    expect(stripHtml("   ")).toBeUndefined();
    expect(stripHtml("<p></p>")).toBeUndefined();
    expect(stripHtml("<br/>")).toBeUndefined();
  });

  it("reads Atom-style title objects instead of throwing", () => {
    expect(stripHtml({ _: "Gemini <b>update</b>", $: { type: "html" } })).toBe("Gemini update");
    expect(stripHtml({ not: "a title" })).toBeUndefined();
  });
});

describe("normalizeFeedItem", () => {
  it("maps a valid RSS entry to a NewsItem with all required fields", () => {
    const item = normalizeFeedItem(
      {
        title: "GPT-5.6 launch",
        link: "https://openai.com/news/gpt-5-6",
        isoDate: "2026-08-13T16:00:00.000Z",
        creator: "OpenAI",
        contentSnippet: "<p>A new model.</p>",
      },
      officialSource,
      fetchedAt
    );

    expect(item).toEqual({
      id: hashUrl("https://openai.com/news/gpt-5-6"),
      sourceId: "openai-news",
      block: "official",
      title: "GPT-5.6 launch",
      url: "https://openai.com/news/gpt-5-6",
      author: "OpenAI",
      summary: "A new model.",
      tags: [],
      company: "OpenAI News",
      region: "us",
      publishedAt: "2026-08-13T16:00:00.000Z",
      fetchedAt,
    });
  });

  it("accepts Atom title and link objects from Google feeds", () => {
    const item = normalizeFeedItem(
      {
        title: { _: "Gemini update", $: { type: "html" } },
        link: { $: { href: "https://blog.google/technology/ai/gemini-update" } },
        isoDate: "2026-08-13T16:00:00.000Z",
      },
      officialSource,
      fetchedAt
    );
    expect(item?.title).toBe("Gemini update");
    expect(item?.url).toBe("https://blog.google/technology/ai/gemini-update");
  });

  it("returns null when url or title is missing", () => {
    expect(
      normalizeFeedItem(
        { title: "No url", isoDate: "2026-08-13T16:00:00.000Z" },
        officialSource,
        fetchedAt
      )
    ).toBeNull();
    expect(
      normalizeFeedItem(
        { link: "https://example.com/no-title", isoDate: "2026-08-13T16:00:00.000Z" },
        officialSource,
        fetchedAt
      )
    ).toBeNull();
    expect(
      normalizeFeedItem(
        { title: "   ", link: "https://example.com/blank-title" },
        officialSource,
        fetchedAt
      )
    ).toBeNull();
    expect(
      normalizeFeedItem(
        { title: "Blank link", link: "   " },
        officialSource,
        fetchedAt
      )
    ).toBeNull();
  });

  it("clamps a future publishedAt to now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00.000Z"));
    const item = normalizeFeedItem(
      {
        title: "From the future",
        link: "https://example.com/future",
        isoDate: "2099-01-01T00:00:00.000Z",
      },
      impartialSource,
      fetchedAt
    );
    expect(item).not.toBeNull();
    expect(item?.publishedAt).toBe("2026-08-14T12:00:00.000Z");
    expect(item?.company).toBeUndefined();
    expect(item?.tags).toEqual([]);
  });

  it("prefers pubDate when isoDate is absent", () => {
    const item = normalizeFeedItem(
      {
        title: "Dated by pubDate",
        link: "https://example.com/pubdate",
        pubDate: "Thu, 13 Aug 2026 16:00:00 GMT",
      },
      impartialSource,
      fetchedAt
    );
    expect(item?.publishedAt).toBe("2026-08-13T16:00:00.000Z");
  });
});
