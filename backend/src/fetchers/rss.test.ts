import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Source } from "../types.js";
import { hashUrl } from "../services/normalize.js";

const { mockParseURL } = vi.hoisted(() => ({
  mockParseURL: vi.fn(),
}));

vi.mock("rss-parser", () => ({
  default: class MockParser {
    parseURL = mockParseURL;
  },
}));

import {
  DEFAULT_MAX_ITEMS,
  RSS_USER_AGENT,
  fetchRssSource,
  fetchRssSources,
} from "./rss.js";

const fetchedNow = "2026-08-14T12:00:00.000Z";

function source(overrides: Partial<Source> & Pick<Source, "id" | "feedUrl">): Source {
  return {
    name: overrides.name ?? overrides.id,
    type: "rss",
    category: "impartial-media",
    region: "us",
    homepage: "https://example.com",
    block: "impartial",
    ...overrides,
  };
}

const sourceA = source({
  id: "feed-a",
  name: "Feed A",
  feedUrl: "https://feed-a.example/rss",
});

const sourceB = source({
  id: "feed-b",
  name: "Feed B",
  feedUrl: "https://feed-b.example/rss",
});

const sourceFail = source({
  id: "feed-fail",
  name: "Feed Fail",
  feedUrl: "https://feed-fail.example/rss",
});

const officialSource = source({
  id: "openai-news",
  name: "OpenAI News",
  category: "official-company",
  block: "official",
  feedUrl: "https://openai.com/news/rss.xml",
  homepage: "https://openai.com/news",
});

beforeEach(() => {
  mockParseURL.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(fetchedNow));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RSS_USER_AGENT / DEFAULT_MAX_ITEMS", () => {
  it("exports the documented constants", () => {
    expect(RSS_USER_AGENT).toBe(
      "Mozilla/5.0 (compatible; Pulso/0.1; +https://pulso.dorly.com.br/)"
    );
    expect(DEFAULT_MAX_ITEMS).toBe(50);
  });
});

describe("fetchRssSource", () => {
  it("maps valid RSS entries to NewsItems with all required fields", async () => {
    mockParseURL.mockResolvedValue({
      items: [
        {
          title: "GPT-5.6 launch",
          link: "https://openai.com/news/gpt-5-6",
          isoDate: "2026-08-13T16:00:00.000Z",
          creator: "OpenAI",
          contentSnippet: "A new model.",
        },
        {
          title: "Missing url is skipped",
          isoDate: "2026-08-13T17:00:00.000Z",
        },
      ],
    });

    const result = await fetchRssSource(officialSource);

    expect(result.sourceId).toBe("openai-news");
    expect(result.error).toBeUndefined();
    expect(result.items).toHaveLength(1);

    const item = result.items[0];
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
      fetchedAt: fetchedNow,
    });
    expect(item.id).toBeTruthy();
    expect(item.sourceId).toBeTruthy();
    expect(item.block).toBeTruthy();
    expect(item.title).toBeTruthy();
    expect(item.url).toBeTruthy();
    expect(item.tags).toEqual([]);
    expect(item.region).toBeTruthy();
    expect(item.publishedAt).toBeTruthy();
    expect(item.fetchedAt).toBeTruthy();
    expect(mockParseURL).toHaveBeenCalledWith("https://openai.com/news/rss.xml");
  });

  it("reads the blog.google element shape instead of choking on it", async () => {
    // Elements carrying attributes arrive from the XML parser as `{_: text, $: attrs}`, not as
    // a string. This is the exact shape that made both blog.google feeds fail in staging with
    // "value.replace is not a function", losing 20 usable items each time.
    mockParseURL.mockResolvedValue({
      items: [
        {
          title: { _: "Gemini ganha modo de pesquisa", $: { type: "html" } },
          link: { _: "https://blog.google/products/gemini/pesquisa", $: { rel: "alternate" } },
          isoDate: "2026-08-13T16:00:00.000Z",
          contentSnippet: { _: "Resumo do anúncio.", $: { type: "html" } },
        },
      ],
    });

    const result = await fetchRssSource(sourceA);

    expect(result.error).toBeUndefined();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("Gemini ganha modo de pesquisa");
    expect(result.items[0]?.url).toBe("https://blog.google/products/gemini/pesquisa");
    expect(result.items[0]?.summary).toBe("Resumo do anúncio.");
  });

  it("keeps the readable items when one entry cannot be normalized", async () => {
    mockParseURL.mockResolvedValue({
      items: [
        {
          title: "Item bom antes",
          link: "https://feed-a.example/1",
          isoDate: "2026-08-13T16:00:00.000Z",
        },
        {
          // Stands in for any shape we did not anticipate: the point is that one entry
          // failing must not cost the whole feed.
          get title(): string {
            throw new TypeError("value.replace is not a function");
          },
          link: "https://feed-a.example/2",
        },
        {
          title: "Item bom depois",
          link: "https://feed-a.example/3",
          isoDate: "2026-08-13T17:00:00.000Z",
        },
      ],
    });

    const result = await fetchRssSource(sourceA);

    expect(result.items.map((item) => item.url)).toEqual([
      "https://feed-a.example/1",
      "https://feed-a.example/3",
    ]);
    // Degradation is reported, so a source shedding entries shows up as a defect on the
    // health page rather than as a quiet news day.
    expect(result.skipped).toBe(1);
    expect(result.error).toContain("1 de 3 itens ilegíveis");
    expect(result.error).toContain("value.replace");
  });

  it("skips entries with no usable url", async () => {
    mockParseURL.mockResolvedValue({
      items: [
        { title: "No link" },
        { title: "Blank link", link: "  " },
        { title: "Keep", link: "https://example.com/keep" },
      ],
    });

    const result = await fetchRssSource(sourceA);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].url).toBe("https://example.com/keep");
    expect(result.items[0].title).toBe("Keep");
  });

  it("clamps future publishedAt to now", async () => {
    mockParseURL.mockResolvedValue({
      items: [
        {
          title: "Future post",
          link: "https://example.com/future",
          isoDate: "2099-01-01T00:00:00.000Z",
        },
      ],
    });

    const result = await fetchRssSource(sourceA);
    expect(result.items[0].publishedAt).toBe(fetchedNow);
  });

  it("slices to maxItems after parse and before normalize", async () => {
    const items = Array.from({ length: DEFAULT_MAX_ITEMS + 15 }, (_, i) => ({
      title: `Post ${i}`,
      link: `https://example.com/post-${i}`,
      isoDate: "2026-08-13T16:00:00.000Z",
    }));
    mockParseURL.mockResolvedValue({ items });

    const result = await fetchRssSource(sourceA);
    expect(result.items).toHaveLength(DEFAULT_MAX_ITEMS);
    expect(result.items[0].url).toBe("https://example.com/post-0");
    expect(result.items.at(-1)?.url).toBe(`https://example.com/post-${DEFAULT_MAX_ITEMS - 1}`);
  });

  it("returns an error result when the source has no feedUrl", async () => {
    const noFeed: Source = {
      id: "anthropic",
      name: "Anthropic",
      type: "ai-discovery",
      category: "ai-discovery",
      region: "us",
      homepage: "https://www.anthropic.com/news",
      block: "ai-discovery",
    };

    const result = await fetchRssSource(noFeed);
    expect(result.sourceId).toBe("anthropic");
    expect(result.items).toEqual([]);
    expect(result.error).toMatch(/feedUrl/i);
    expect(mockParseURL).not.toHaveBeenCalled();
  });

  it("returns an error result when parseURL throws", async () => {
    mockParseURL.mockRejectedValue(new Error("ECONNRESET"));
    const result = await fetchRssSource(sourceA);
    expect(result.sourceId).toBe("feed-a");
    expect(result.items).toEqual([]);
    expect(result.error).toBe("ECONNRESET");
  });
});

describe("fetchRssSources", () => {
  it("isolates a failing source so others still return items", async () => {
    mockParseURL.mockImplementation((url: string) => {
      if (url === sourceFail.feedUrl) {
        throw new Error("feed down");
      }
      if (url === sourceA.feedUrl) {
        return {
          items: [
            {
              title: "From A",
              link: "https://example.com/a",
              isoDate: "2026-08-13T16:00:00.000Z",
            },
          ],
        };
      }
      if (url === sourceB.feedUrl) {
        return {
          items: [
            {
              title: "From B",
              link: "https://example.com/b",
              isoDate: "2026-08-13T16:00:00.000Z",
            },
          ],
        };
      }
      throw new Error(`unexpected url ${url}`);
    });

    const { items, results } = await fetchRssSources([sourceA, sourceFail, sourceB]);

    expect(results).toHaveLength(3);
    expect(results[0].error).toBeUndefined();
    expect(results[0].items).toHaveLength(1);
    expect(results[1].error).toBe("feed down");
    expect(results[1].items).toEqual([]);
    expect(results[2].error).toBeUndefined();
    expect(results[2].items).toHaveLength(1);

    expect(items.map((item) => item.url)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("dedupes the combined list by url (first wins)", async () => {
    mockParseURL.mockImplementation((url: string) => {
      if (url === sourceA.feedUrl) {
        return {
          items: [
            {
              title: "First title",
              link: "https://example.com/shared",
              isoDate: "2026-08-13T16:00:00.000Z",
            },
            {
              title: "Only A",
              link: "https://example.com/only-a",
              isoDate: "2026-08-13T16:00:00.000Z",
            },
          ],
        };
      }
      if (url === sourceB.feedUrl) {
        return {
          items: [
            {
              title: "Second title should lose",
              link: "https://example.com/shared",
              isoDate: "2026-08-13T17:00:00.000Z",
            },
            {
              title: "Only B",
              link: "https://example.com/only-b",
              isoDate: "2026-08-13T16:00:00.000Z",
            },
          ],
        };
      }
      throw new Error(`unexpected url ${url}`);
    });

    const { items, results } = await fetchRssSources([sourceA, sourceB]);

    expect(results[0].items).toHaveLength(2);
    expect(results[1].items).toHaveLength(2);
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.url)).toEqual([
      "https://example.com/shared",
      "https://example.com/only-a",
      "https://example.com/only-b",
    ]);
    expect(items[0].title).toBe("First title");
    expect(items[0].sourceId).toBe("feed-a");
  });
});
