import { describe, expect, it, vi } from "vitest";
import type { WebSearchCandidate, WebSearchResult } from "../fetchers/webSearch.js";
import type { PulsoItem } from "./schema.js";
import type { VerifyLinksResult } from "./verifyLinks.js";
import { evaluateShadowSearch, publishedWithin, urlKey, webSearchMode } from "./webSearchShadow.js";

const windowStart = new Date("2026-10-08T10:30:00Z");
const windowEnd = new Date("2026-10-09T10:30:00Z");

function candidate(url: string): WebSearchCandidate {
  return {
    title: `Título ${url}`,
    url,
    outlet: "Veículo",
    publishedAt: "2026-10-09T08:00:00Z",
    region: "asia",
    language: "en",
    why: "importa",
    searchRegion: "asia",
  };
}

describe("evaluateShadowSearch", () => {
  it("runs each result through the candidate checks and reports what would be added", async () => {
    const urls = {
      known: "https://site.com/conhecida",
      broken: "https://site.com/quebrada",
      undated: "https://site.com/sem-data",
      stale: "https://site.com/velha",
      offTopic: "https://site.com/sem-ia",
      good: "https://site.com/nova",
    };
    const search: WebSearchResult = {
      candidates: Object.values(urls).map(candidate),
      usage: { inputTokens: 1000, outputTokens: 100, webSearchCalls: 7 },
      queries: ["q1"],
      errors: [],
    };
    const verifyLinks = vi.fn((items: PulsoItem[]): Promise<VerifyLinksResult> => {
      const ok = items.filter((item) => item.url !== urls.broken);
      return Promise.resolve({
        items: ok,
        dropped: items.filter((item) => item.url === urls.broken).map((item) => ({ item, ok: false, reason: "blocked" as const })),
        dates: new Map([
          [urls.stale, "2026-10-01T10:00:00Z"],
          [urls.offTopic, "2026-10-09T07:00:00Z"],
          [urls.good, "2026-10-09"],
        ]),
      });
    });
    const classify = vi.fn((items: PulsoItem[]) =>
      Promise.resolve({
        items: items.filter((item) => item.url === urls.good),
        dropped: items.filter((item) => item.url !== urls.good),
        model: "gpt-6-luna",
        usage: { inputTokens: 300, outputTokens: 50 },
      })
    );

    const { report, classifyUsage } = await evaluateShadowSearch({
      search,
      windowStart,
      windowEnd,
      model: "gpt-6-luna",
      isKnown: (url) => url === urls.known,
      verifyLinks,
      classify,
    });

    expect(verifyLinks.mock.calls[0]?.[0].every((item) => item.kind === "discovery")).toBe(true);
    expect(classify.mock.calls[0]?.[0].map((item) => item.kind)).toEqual(["press", "press"]);
    expect(report.counts).toEqual({
      "ja-conhecida": 1,
      link: 1,
      "sem-data": 1,
      "fora-da-janela": 1,
      "fora-do-tema": 1,
    });
    expect(report.wouldAdd.map((row) => row.url)).toEqual([urls.good]);
    // The page's own date, not the model's.
    expect(report.wouldAdd[0]?.publishedAt).toBe("2026-10-09");
    expect(report.searches).toBe(7);
    expect(report.candidates).toBe(6);
    expect(classifyUsage).toEqual({ inputTokens: 300, outputTokens: 50 });
  });

  it("makes no page or model call when every result is already known", async () => {
    const verifyLinks = vi.fn();
    const classify = vi.fn();
    const { report } = await evaluateShadowSearch({
      search: { candidates: [candidate("https://site.com/a")], queries: [], errors: [] },
      windowStart,
      windowEnd,
      model: "gpt-6-luna",
      isKnown: () => true,
      verifyLinks,
      classify,
    });

    expect(verifyLinks).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
    expect(report.counts["ja-conhecida"]).toBe(1);
    expect(report.wouldAdd).toEqual([]);
  });
});

describe("publishedWithin", () => {
  it("gives a day-only date the whole São Paulo day the window started on", () => {
    // 10:30 UTC is 07:30 in São Paulo, still 2026-10-08 there.
    expect(publishedWithin("2026-10-08", windowStart)).toBe(true);
    expect(publishedWithin("2026-10-07", windowStart)).toBe(false);
  });

  it("allows a timestamp up to two hours before the window, not more", () => {
    expect(publishedWithin("2026-10-08T09:00:00Z", windowStart)).toBe(true);
    expect(publishedWithin("2026-10-08T08:00:00Z", windowStart)).toBe(false);
    expect(publishedWithin("ontem", windowStart)).toBe(false);
  });
});

describe("webSearchMode and urlKey", () => {
  it("runs the search only when shadow is asked for", () => {
    expect(webSearchMode("shadow")).toBe("shadow");
    expect(webSearchMode(" Shadow ")).toBe("shadow");
    expect(webSearchMode("on")).toBe("off");
    expect(webSearchMode(undefined)).toBe("off");
  });

  it("matches the same article behind tracking parameters and a trailing slash", () => {
    expect(urlKey("https://www.scmp.com/tech/a?utm_source=rss_feed")).toBe(urlKey("https://scmp.com/tech/a/"));
  });
});
