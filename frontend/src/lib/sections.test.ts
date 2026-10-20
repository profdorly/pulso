import { describe, expect, it } from "vitest";
import { partitionItems, sectionTotal, SECTION_TITLE, neighboringEditions } from "./sections.js";
import type { PulsoIndex, PulsoItem } from "./edition.js";

function item(overrides: Partial<PulsoItem> & Pick<PulsoItem, "id">): PulsoItem {
  return {
    title: "Título",
    url: `https://example.com/${overrides.id}`,
    outlet: "Veículo",
    region: "us",
    kind: "press",
    publishedAt: "2026-08-14T10:00:00.000Z",
    firstSeenAt: "2026-08-14T10:30:00.000Z",
    ...overrides,
  };
}

describe("partitionItems", () => {
  it("puts Brazilian press with the rest of the press, not in a Brazil caderno", () => {
    const local = item({ id: "br", region: "brazil", kind: "press" });
    const sections = partitionItems([local]);

    expect(sections.press.map((row) => row.id)).toEqual(["br"]);
    expect(sections.labs).toEqual([]);
  });

  it("groups lab announcements and discovery together even when the lab is Brazilian", () => {
    const lab = item({ id: "lab", kind: "lab" });
    const discovery = item({ id: "disc", kind: "discovery" });
    const maritaca = item({ id: "br-lab", region: "brazil", kind: "lab" });
    const sections = partitionItems([lab, discovery, maritaca]);

    expect(sections.labs.map((row) => row.id)).toEqual(["lab", "disc", "br-lab"]);
    expect(sections.press).toEqual([]);
  });

  it("never loses or duplicates an item", () => {
    const items = [
      item({ id: "br-press", region: "brazil", kind: "press" }),
      item({ id: "br-lab", region: "brazil", kind: "lab" }),
      item({ id: "us-lab", kind: "lab" }),
      item({ id: "cn-press", region: "asia", kind: "press" }),
      item({ id: "us-disc", kind: "discovery" }),
    ];
    const sections = partitionItems(items);

    expect(sectionTotal(sections)).toBe(items.length);
    const seen = [...sections.labs, ...sections.press].map((row) => row.id);
    expect(new Set(seen).size).toBe(items.length);
    expect(sections.press.map((row) => row.id)).toEqual(["br-press", "cn-press"]);
    expect(sections.labs.map((row) => row.id)).toEqual(["br-lab", "us-lab", "us-disc"]);
  });

  it("returns empty sections for an empty edition", () => {
    const sections = partitionItems([]);
    expect(sectionTotal(sections)).toBe(0);
  });

  it("names the two lists for the reader", () => {
    expect(SECTION_TITLE.press).toBe("Imprensa");
    expect(SECTION_TITLE.labs).toBe("Direto dos labs");
    expect(SECTION_TITLE.featured).toBe("Prioridades");
    expect(SECTION_TITLE.radar).toBe("Radar");
  });
});

describe("neighboringEditions", () => {
  it("walks the newest-first index", () => {
    const index = {
      schemaVersion: 1,
      latestId: "c",
      editions: [
        { id: "c", slot: "tarde", calendarDate: "2026-08-15", capturedAt: "2026-08-15T19:00:00.000Z", headline: "C", path: "/c" },
        { id: "b", slot: "manha", calendarDate: "2026-08-15", capturedAt: "2026-08-15T10:00:00.000Z", headline: "B", path: "/b" },
        { id: "a", slot: "tarde", calendarDate: "2026-08-14", capturedAt: "2026-08-14T19:00:00.000Z", headline: "A", path: "/a" },
      ],
    } as PulsoIndex;

    expect(neighboringEditions(index, "b")).toEqual({
      newer: index.editions[0],
      older: index.editions[2],
    });
    expect(neighboringEditions(index, "c").newer).toBeNull();
    expect(neighboringEditions(index, "a").older).toBeNull();
  });
});
