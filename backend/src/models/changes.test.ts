import { describe, expect, it } from "vitest";
import { catalogChanges } from "./changes.js";
import { modelFamily, bestOfEachFamily } from "./family.js";
import type { MetricKey, Modality, ModelCatalog, ModelRecord } from "./types.js";

function model(
  id: string,
  values: Partial<Record<MetricKey, number>>,
  options: { modality?: Modality; version?: string } = {}
): ModelRecord {
  return {
    id,
    name: id.toUpperCase(),
    creator: "Lab",
    modality: options.modality ?? "language",
    observations: Object.entries(values).map(([metric, value]) => ({
      metric: metric as MetricKey,
      value: value,
      source: "artificial-analysis" as const,
      benchmark: "b",
      ...(metric === "intelligence-index" && options.version ? { benchmarkVersion: options.version } : {}),
      capturedAt: "t",
      methodologyUrl: "u",
    })),
  };
}

function catalog(capturedAt: string, language: ModelRecord[], image: ModelRecord[] = []): ModelCatalog {
  return {
    schemaVersion: 1,
    capturedAt,
    sources: ["artificial-analysis"],
    sections: [
      { modality: "language", group: "texto", availableMetrics: [], models: language, totalAvailable: language.length, notes: [] },
      { modality: "text-to-image", group: "imagem", availableMetrics: [], models: image, totalAvailable: image.length, notes: [] },
    ],
    coverage: [],
  };
}

describe("catalogChanges", () => {
  it("has nothing to say about the first capture", () => {
    expect(catalogChanges(null, catalog("2026-10-19", [model("a", {})]))).toBeNull();
  });

  it("lists who entered and left the list, index moves of a point or more, and price changes", () => {
    const before = catalog("2026-10-12", [
      model("a", { "intelligence-index": 60, "price-input-1m": 5 }),
      model("b", { "intelligence-index": 50.4, "price-input-1m": 1 }),
      model("gone", { "intelligence-index": 40 }),
    ]);
    const after = catalog("2026-10-19", [
      model("a", { "intelligence-index": 62, "price-input-1m": 5 }),
      model("b", { "intelligence-index": 50.9, "price-input-1m": 0.5 }),
      model("new", { "intelligence-index": 55 }),
    ]);

    const changes = catalogChanges(before, after)!;
    expect(changes.since).toBe("2026-10-12");
    expect(changes.comparable).toBe(true);
    expect(changes.entered.map((m) => m.id)).toEqual(["new"]);
    expect(changes.left.map((m) => m.id)).toEqual(["gone"]);
    // b's half point is noise; its price halving is not. The bigger relative move comes first.
    expect(changes.moved.map((m) => [m.id, m.metric, m.before, m.after])).toEqual([
      ["b", "price-input-1m", 1, 0.5],
      ["a", "intelligence-index", 60, 62],
    ]);
  });

  it("reports no score moves across an index version change, only prices", () => {
    const before = catalog("t0", [model("a", { "intelligence-index": 70, "price-output-1m": 10 }, { version: "3" })]);
    const after = catalog("t1", [model("a", { "intelligence-index": 55, "price-output-1m": 8 }, { version: "4" })]);

    const changes = catalogChanges(before, after)!;
    expect(changes.comparable).toBe(false);
    expect(changes.indexVersions).toEqual({ before: "3", after: "4" });
    expect(changes.moved.map((m) => m.metric)).toEqual(["price-output-1m"]);
  });

  it("does not read a failed modality as everyone leaving", () => {
    const before = catalog("t0", [model("a", { "intelligence-index": 1 }, { version: "3" })]);
    const changes = catalogChanges(before, catalog("t1", []))!;
    expect(changes.left).toEqual([]);
    expect(changes.entered).toEqual([]);
    // Nor as the index changing version.
    expect(changes.comparable).toBe(true);
    expect(changes.indexVersions).toBeUndefined();
  });

  it("says when a media board's first place changed hands", () => {
    const image = (ids: string[]) => ids.map((id) => model(id, { "arena-elo": 1000 }, { modality: "text-to-image" }));
    const changes = catalogChanges(catalog("t0", [], image(["x", "y"])), catalog("t1", [], image(["y", "x"])))!;
    expect(changes.leaders).toEqual([
      {
        modality: "text-to-image",
        before: { id: "x", name: "X", creator: "Lab" },
        after: { id: "y", name: "Y", creator: "Lab" },
      },
    ]);
  });
});

describe("modelFamily", () => {
  it("drops the trailing configuration, and keeps the first row of each family", () => {
    expect(modelFamily("Claude Opus 5.5 (Max, Default Fallback)")).toBe("claude opus 5.5");
    expect(modelFamily("GPT-6 Luna")).toBe("gpt-6 luna");
    const rows = ["A (High)", "A (Low)", "B", "a"];
    expect(bestOfEachFamily(rows, (row) => row)).toEqual(["A (High)", "B"]);
  });
});
