import { describe, expect, it } from "vitest";
import type { PulsoEdition, PulsoItem } from "./edition.js";
import { splitByPriority } from "./priority.js";

function item(id: string, url: string): PulsoItem {
  return {
    id,
    title: id,
    url,
    outlet: "Veículo",
    region: "us",
    kind: "press",
    publishedAt: "2026-08-14T10:00:00.000Z",
    firstSeenAt: "2026-08-14T10:30:00.000Z",
  };
}

describe("splitByPriority", () => {
  it("puts digest URLs first and the rest in the radar", () => {
    const featuredItem = item("a", "https://a.example/1");
    const radarItem = item("b", "https://b.example/2");
    const edition = {
      digest: {
        headline: "Capa",
        lede: "Lede",
        bullets: [{ text: "Destaque", url: featuredItem.url, outlet: "Veículo" }],
      },
      items: [radarItem, featuredItem],
    } as PulsoEdition;

    const split = splitByPriority(edition);
    expect(split.featured.map((row) => row.id)).toEqual(["a"]);
    expect(split.radar.map((row) => row.id)).toEqual(["b"]);
  });
});
