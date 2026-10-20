import { describe, expect, it } from "vitest";
import { hashUrl } from "../services/normalize.js";
import type { NewsItem, Region } from "../types.js";
import { NEW_ITEM_CAP, PRESS_MIN_SLOTS, PRESS_SOURCE_CAP, classify, selectForEdition } from "./select.js";

let sequence = 0;

/** Minutes-apart timestamps so recency is unambiguous without writing dates by hand. */
function item(overrides: {
  region: Region;
  block?: NewsItem["block"];
  title?: string;
  url?: string;
  minutesAgo?: number;
  sourceId?: string;
}): NewsItem {
  sequence += 1;
  const url = overrides.url ?? `https://outlet-${overrides.region}.example/${sequence}`;
  const minutesAgo = overrides.minutesAgo ?? sequence;
  return {
    id: hashUrl(url),
    sourceId: overrides.sourceId ?? `source-${overrides.region}`,
    block: overrides.block ?? "impartial",
    title: overrides.title ?? `Item ${sequence}`,
    url,
    region: overrides.region,
    tags: [],
    publishedAt: new Date(Date.UTC(2026, 7, 14, 12, 0) - minutesAgo * 60_000).toISOString(),
    fetchedAt: "2026-08-14T12:30:00.000Z",
  };
}

/**
 * Press from a region, each item from a different outlet.
 *
 * Distinct outlets by default so these fixtures exercise the region quota on its own. The
 * per-outlet cap has its own test, which sets the outlet explicitly.
 */
function press(region: Region, count: number, startMinutes = 1): NewsItem[] {
  return Array.from({ length: count }, (_, index) =>
    item({
      region,
      minutesAgo: startMinutes + index,
      sourceId: `source-${region}-${String(index)}`,
    })
  );
}

describe("classify", () => {
  it("treats lab and discovery as primary sources, everything else as press", () => {
    expect(classify(item({ region: "us", block: "official" }))).toBe("primary");
    expect(classify(item({ region: "asia", block: "ai-discovery" }))).toBe("primary");
    expect(classify(item({ region: "brazil", block: "impartial" }))).toBe("press");
  });
});

describe("selectForEdition", () => {
  it("stops a high-volume region from taking the whole cover", () => {
    // The failure this exists to prevent: Brazilian outlets publish far more often, so pure
    // recency filled all five published slots with Brazilian press.
    const candidates = [
      ...press("brazil", 20, 1),
      ...press("us", 5, 100),
      ...press("europe", 5, 200),
      ...press("asia", 5, 300),
    ];

    const result = selectForEdition(candidates, { cap: 8 });

    expect(result.selected).toHaveLength(8);
    // Every region that had candidates is represented, and Brazil does not exceed its share
    // despite being both newer and far more numerous.
    expect(result.pressByRegion).toEqual({ brazil: 2, us: 2, europe: 2, asia: 2 });
  });

  it("gives the leftover slot to a region that is behind, not to a fixed favourite", () => {
    const candidates = [
      ...press("brazil", 3, 1),
      ...press("us", 3, 100),
      ...press("europe", 3, 200),
      ...press("asia", 3, 300),
    ];

    // 9 slots over 4 regions: two full rounds plus one leftover.
    const result = selectForEdition(candidates, { cap: 9 });
    const counts = Object.values(result.pressByRegion).sort();
    expect(counts).toEqual([2, 2, 2, 3]);
    // The extra slot went to the region whose next candidate ranked best, which with equal
    // standing means the most recent — Brazil here.
    expect(result.pressByRegion.brazil).toBe(3);
  });

  it("does not hold a slot open for a region with nothing to say", () => {
    const candidates = [...press("brazil", 4, 1), ...press("asia", 4, 100)];

    const result = selectForEdition(candidates, { cap: 8 });

    expect(result.selected).toHaveLength(8);
    expect(result.pressByRegion).toEqual({ brazil: 4, us: 0, europe: 0, asia: 4 });
  });

  it("stops one outlet from filling the edition on volume alone", () => {
    // The failure this exists to prevent: a high-volume wire tagged to one region satisfied
    // that region by itself, and an edition came out with ten of fifteen items from it.
    const floodSize = PRESS_SOURCE_CAP * 3;
    const flood = Array.from({ length: floodSize }, (_, index) =>
      item({ region: "asia", minutesAgo: 1 + index, sourceId: "nikkei-asia" })
    );
    const others = PRESS_SOURCE_CAP + 3;
    const candidates = [...flood, ...press("us", others, 100), ...press("europe", others, 200)];
    // One slot more per region than the outlet may take, so the outlet cap is what binds.
    const cap = 3 * (PRESS_SOURCE_CAP + 1);

    const result = selectForEdition(candidates, { cap });

    const fromFlood = result.selected.filter((entry) => entry.sourceId === "nikkei-asia");
    expect(fromFlood).toHaveLength(PRESS_SOURCE_CAP);
    // The slots it would have taken go to other newsrooms rather than staying empty.
    expect(result.selected).toHaveLength(cap);
    // And the overflow is deferred, not rejected: it stays eligible for a later edition.
    expect(result.deferred.filter((entry) => entry.sourceId === "nikkei-asia")).toHaveLength(
      floodSize - PRESS_SOURCE_CAP
    );
  });

  it("keeps the outlet cap per outlet, not per region", () => {
    const perOutlet = PRESS_SOURCE_CAP + 2;
    const candidates = [
      ...Array.from({ length: perOutlet }, (_, index) =>
        item({ region: "asia", minutesAgo: 1 + index, sourceId: "nikkei-asia" })
      ),
      ...Array.from({ length: perOutlet }, (_, index) =>
        item({ region: "asia", minutesAgo: 50 + index, sourceId: "scmp-tech" })
      ),
    ];

    const result = selectForEdition(candidates, { cap: 2 * PRESS_SOURCE_CAP + 2 });

    // One region, two newsrooms: each gets its own allowance instead of sharing one.
    expect(result.selected.filter((entry) => entry.sourceId === "nikkei-asia")).toHaveLength(
      PRESS_SOURCE_CAP
    );
    expect(result.selected.filter((entry) => entry.sourceId === "scmp-tech")).toHaveLength(
      PRESS_SOURCE_CAP
    );
  });

  it("lets lab announcements in without rationing them by continent", () => {
    const candidates = [
      item({ region: "us", block: "official", minutesAgo: 400 }),
      item({ region: "us", block: "official", minutesAgo: 401 }),
      item({ region: "asia", block: "ai-discovery", minutesAgo: 402 }),
      ...press("brazil", 10, 1),
    ];

    const result = selectForEdition(candidates, { cap: 6 });

    // All three primaries are in even though two share a region and all are older than the
    // Brazilian press: an announcement is the fact itself.
    const primaries = result.selected.filter(
      (entry) => entry.block === "official" || entry.block === "ai-discovery"
    );
    expect(primaries).toHaveLength(3);
    expect(result.selected).toHaveLength(6);
  });

  it("keeps a floor for press when announcements would fill the whole edition", () => {
    const candidates = [
      ...Array.from({ length: NEW_ITEM_CAP + 5 }, (_, index) =>
        item({ region: "us", block: "official", minutesAgo: index + 1 })
      ),
      ...press("brazil", PRESS_MIN_SLOTS / 2 + 3, 500),
      ...press("europe", PRESS_MIN_SLOTS / 2 + 3, 600),
    ];

    const result = selectForEdition(candidates);

    expect(result.selected).toHaveLength(NEW_ITEM_CAP);
    const pressTaken = Object.values(result.pressByRegion).reduce((a, b) => a + b, 0);
    // Without the floor a launch day would leave the quota nothing to balance.
    expect(pressTaken).toBe(PRESS_MIN_SLOTS);
  });

  it("never lets the press floor starve primary announcements on a small edition", () => {
    // Regression: the floor is capped at half the edition. Taking it literally on a cap
    // smaller than the floor reserved every slot for press and let no announcement through,
    // which inverts what the floor is for.
    const candidates = [
      item({ region: "us", block: "official", minutesAgo: 400 }),
      item({ region: "us", block: "official", minutesAgo: 401 }),
      ...press("brazil", 10, 1),
    ];

    const result = selectForEdition(candidates, { cap: 4 });

    const primaries = result.selected.filter((entry) => entry.block === "official");
    expect(primaries).toHaveLength(2);
    expect(result.selected).toHaveLength(4);
  });

  it("ranks a material story above a newer generic recap in the same region", () => {
    const newer = item({
      region: "us",
      title: "Festival de Reels ganha data",
      minutesAgo: 1,
    });
    const older = item({
      region: "us",
      title: "UE regula modelos de uso geral",
      minutesAgo: 200,
      sourceId: "source-us-other",
    });

    const result = selectForEdition([newer, older], { cap: 1 });
    expect(result.selected.map((entry) => entry.title)).toEqual(["UE regula modelos de uso geral"]);
  });

  it("ranks reporting above opinion inside a region", () => {
    const opinion = item({
      region: "brazil",
      title: "OPINIÃO: O jurídico não precisa só de IA",
      minutesAgo: 1,
    });
    const reporting = item({ region: "brazil", title: "Zhipu lança o GLM-5.3", minutesAgo: 90 });

    const result = selectForEdition([opinion, reporting], { cap: 1 });

    // The column is newer, and still loses to reporting.
    expect(result.selected.map((entry) => entry.title)).toEqual(["Zhipu lança o GLM-5.3"]);
    expect(result.deferred.map((entry) => entry.title)).toEqual([
      "OPINIÃO: O jurídico não precisa só de IA",
    ]);
  });

  it("defers what does not fit instead of losing it", () => {
    const candidates = press("brazil", 12, 1);
    const result = selectForEdition(candidates, { cap: 5 });

    expect(result.selected).toHaveLength(5);
    expect(result.deferred).toHaveLength(7);
    // Nothing vanishes: every candidate is accounted for in exactly one bucket.
    const seen = new Set([...result.selected, ...result.deferred].map((entry) => entry.url));
    expect(seen.size).toBe(candidates.length);
  });

  it("returns the edition newest first so it still reads chronologically", () => {
    const candidates = [
      item({ region: "us", block: "official", minutesAgo: 500 }),
      ...press("brazil", 2, 1),
      ...press("asia", 2, 50),
    ];

    const result = selectForEdition(candidates, { cap: 5 });
    const times = result.selected.map((entry) => Date.parse(entry.publishedAt));
    expect([...times]).toEqual([...times].sort((a, b) => b - a));
  });

  it("handles an empty pool without inventing slots", () => {
    const result = selectForEdition([], { cap: 10 });
    expect(result.selected).toEqual([]);
    expect(result.deferred).toEqual([]);
  });
});
