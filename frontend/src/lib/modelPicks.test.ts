import { describe, expect, it } from "vitest";
import type { MetricKey, ModelRecord } from "./modelCatalog.js";
import { blendedPrice, modelFamily, modelPicks, priceFrontier, splitModelLabel } from "./modelPicks.js";

function model(id: string, name: string, values: Partial<Record<MetricKey, number>>): ModelRecord {
  return {
    id,
    name,
    creator: "Lab",
    modality: "language",
    observations: Object.entries(values).map(([metric, value]) => ({
      metric: metric as MetricKey,
      value,
      source: "artificial-analysis" as const,
      benchmark: "b",
      capturedAt: "t",
      methodologyUrl: "u",
    })),
  };
}

const price = (input: number, output: number) => ({ "price-input-1m": input, "price-output-1m": output });

const models = [
  model("opus-max", "Opus (Max)", { "intelligence-index": 60, ...price(15, 75), "output-tokens-per-second": 50 }),
  model("opus-low", "Opus (Low)", { "intelligence-index": 55, ...price(15, 75), "output-tokens-per-second": 70 }),
  model("mid", "Mid", { "intelligence-index": 52, ...price(1, 4), "output-tokens-per-second": 120 }),
  model("pricey", "Pricey", { "intelligence-index": 50, ...price(20, 80) }),
  model("tiny", "Tiny", { "intelligence-index": 30, ...price(0.05, 0.2), "output-tokens-per-second": 400 }),
  model("unpriced", "Unpriced", { "intelligence-index": 58 }),
];

describe("model picks", () => {
  it("splits and groups configurations of one model", () => {
    expect(splitModelLabel("Claude Opus 5 (Max Effort)")).toEqual({ name: "Claude Opus 5", variant: "Max Effort" });
    expect(splitModelLabel("Mid")).toEqual({ name: "Mid", variant: null });
    expect(modelFamily("Opus (Max)")).toBe(modelFamily("Opus (Low)"));
  });

  it("blends price three input to one output, and only with both published", () => {
    expect(blendedPrice(models[2]!)).toBe(1.75);
    expect(blendedPrice(models[5]!)).toBeUndefined();
  });

  it("keeps on the frontier only models nothing beats on both axes, cheapest first", () => {
    // Pricey costs more than Opus and scores less; Opus (Low) costs the same as Opus (Max) and
    // scores less. Unpriced cannot be placed at all.
    expect(priceFrontier(models).map((point) => point.model.id)).toEqual(["tiny", "mid", "opus-max"]);
  });

  it("answers each question once per model, and keeps the leader out of the value list", () => {
    const lists = Object.fromEntries(modelPicks(models).map((list) => [list.id, list.picks.map((pick) => pick.model.id)]));
    expect(lists).toEqual({
      "mais-inteligente": ["opus-max", "unpriced", "mid"],
      "mais-rapido": ["tiny", "mid", "opus-low"],
      "mais-barato": ["tiny", "mid", "opus-max"],
      "custo-beneficio": ["mid", "tiny"],
    });
    const value = modelPicks(models).find((list) => list.id === "custo-beneficio")!;
    expect(value.picks[0]!.display).toBe("52.0 por US$ 1.75");
  });

  it("leaves out a list with nothing to show", () => {
    const unpriced = [model("a", "A", { "intelligence-index": 40 })];
    expect(modelPicks(unpriced).map((list) => list.id)).toEqual(["mais-inteligente"]);
  });
});
