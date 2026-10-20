import { describe, expect, it } from "vitest";
import { hostKey, resolveOrigins, urlKey } from "./origin.js";
import type { PulsoItem } from "./schema.js";
import type { PageLinks } from "./verifyLinks.js";

function item(overrides: Partial<PulsoItem> & Pick<PulsoItem, "url" | "outlet">): PulsoItem {
  return {
    id: overrides.url,
    title: overrides.title ?? `Título de ${overrides.outlet}`,
    region: overrides.region ?? "brazil",
    kind: overrides.kind ?? "press",
    genre: overrides.genre ?? "news",
    publishedAt: overrides.publishedAt ?? "2026-08-14T12:00:00.000Z",
    firstSeenAt: "2026-08-14T12:30:00.000Z",
    ...overrides,
  };
}

function links(entries: Array<[string, PageLinks]>): Map<string, PageLinks> {
  return new Map(entries);
}

const WIRED = "https://www.wired.com/story/glm-5-3";
const TECNOBLOG = "https://tecnoblog.net/noticias/glm-5-3";

describe("urlKey", () => {
  it("compares articles ignoring protocol, www, query and trailing slash", () => {
    expect(urlKey("https://www.wired.com/story/x/")).toBe(urlKey("http://wired.com/story/x?utm=1"));
  });

  it("falls back to the raw string when the url does not parse", () => {
    expect(urlKey("  NAO-E-URL ")).toBe("nao-e-url");
  });
});

describe("hostKey", () => {
  it("strips www and lowercases", () => {
    expect(hostKey("https://WWW.Reuters.com/tech/x")).toBe("reuters.com");
  });
});

describe("resolveOrigins", () => {
  it("drops a syndicated copy only when its canonical original was fetched", () => {
    const original = item({ url: WIRED, outlet: "Wired", region: "us" });
    const copy = item({ url: TECNOBLOG, outlet: "Tecnoblog" });

    const result = resolveOrigins({
      items: [copy, original],
      links: links([
        [TECNOBLOG, { canonical: WIRED, outbound: [] }],
        [WIRED, { outbound: [] }],
      ]),
    });

    expect(result.items.map((entry) => entry.url)).toEqual([WIRED]);
    expect(result.items[0]?.corroboration).toBe(2);
    expect(result.dropped[0]?.item.url).toBe(TECNOBLOG);
    expect(result.dropped[0]?.inFavorOf).toBe(WIRED);
  });

  it("keeps the accessible copy when the selected original was not fetched", () => {
    const inaccessible = item({ url: WIRED, outlet: "Wired", region: "us" });
    const copy = item({ url: TECNOBLOG, outlet: "Tecnoblog" });

    const result = resolveOrigins({
      items: [copy, inaccessible],
      // The copy was fetched and names Wired as canonical. Wired was retained after a block,
      // so it has no PageLinks entry and cannot replace the article we actually read.
      links: links([[TECNOBLOG, { canonical: WIRED, outbound: [] }]]),
    });

    expect(result.dropped).toEqual([]);
    expect(result.items.map((entry) => entry.url)).toEqual([TECNOBLOG, WIRED]);
    expect(result.items[0]?.originHost).toBe("wired.com");
  });

  it("keeps the replication when an external canonical is not in the edition", () => {
    const copy = item({ url: TECNOBLOG, outlet: "Tecnoblog" });
    const result = resolveOrigins({
      items: [copy],
      links: links([[TECNOBLOG, { canonical: "https://www.reuters.com/tech/glm", outbound: [] }]]),
    });

    expect(result.dropped).toEqual([]);
    expect(result.items[0]?.url).toBe(TECNOBLOG);
    expect(result.items[0]?.originHost).toBe("reuters.com");
  });

  it("follows a fetched canonical chain to its final source", () => {
    const source = item({ url: WIRED, outlet: "Wired", region: "us" });
    const middle = item({ url: "https://mid.example/a", outlet: "Meio" });
    const last = item({ url: "https://last.example/b", outlet: "Último" });

    const result = resolveOrigins({
      items: [last, middle, source],
      links: links([
        [last.url, { canonical: middle.url, outbound: [] }],
        [middle.url, { canonical: source.url, outbound: [] }],
        [source.url, { outbound: [] }],
      ]),
    });

    expect(result.items.map((entry) => entry.url)).toEqual([WIRED]);
    expect(result.items[0]?.corroboration).toBe(3);
    expect(result.dropped.map((row) => row.inFavorOf)).toEqual([WIRED, WIRED]);
  });

  it("never drops both sides of a bad canonical cycle", () => {
    const older = item({ url: "https://a.example/x", outlet: "A", publishedAt: "2026-08-14T10:00:00.000Z" });
    const newer = item({ url: "https://b.example/y", outlet: "B", publishedAt: "2026-08-14T11:00:00.000Z" });

    const result = resolveOrigins({
      items: [older, newer],
      links: links([
        [older.url, { canonical: newer.url, outbound: [] }],
        [newer.url, { canonical: older.url, outbound: [] }],
      ]),
    });

    expect(result.items.map((entry) => entry.url)).toEqual([older.url]);
    expect(result.dropped).toHaveLength(1);
  });

  it("never treats an ordinary outbound link as syndication", () => {
    const a = item({ url: "https://a.example/x", outlet: "A" });
    const b = item({ url: "https://b.example/y", outlet: "B" });

    const result = resolveOrigins({
      items: [a, b],
      links: links([
        [a.url, { outbound: [b.url] }],
        [b.url, { outbound: ["https://github.com/repo"] }],
      ]),
    });

    expect(result.items).toEqual([a, b]);
    expect(result.dropped).toEqual([]);
  });

  it("leaves items alone when no page was fetched", () => {
    const a = item({ url: "https://a.example/x", outlet: "A" });
    const result = resolveOrigins({ items: [a], links: new Map() });
    expect(result.items).toEqual([a]);
    expect(result.dropped).toEqual([]);
  });
});
