import { describe, expect, it } from "vitest";
import { hashUrl } from "../services/normalize.js";
import type { NewsItem } from "../types.js";
import { compareByEditorialRank, executiveMateriality } from "./materiality.js";

function item(title: string, minutesAgo: number, block: NewsItem["block"] = "impartial"): NewsItem {
  const url = `https://example.com/${hashUrl(title).slice(0, 8)}`;
  return {
    id: hashUrl(url),
    sourceId: "outlet",
    block,
    title,
    url,
    tags: [],
    region: "us",
    publishedAt: new Date(Date.UTC(2026, 7, 14, 12, 0) - minutesAgo * 60_000).toISOString(),
    fetchedAt: "2026-08-14T12:30:00.000Z",
  };
}

describe("executiveMateriality", () => {
  it("scores a regulatory fine above a generic recap", () => {
    const fine = executiveMateriality(
      item("UE multa empresa de IA em €500 milhões", 90)
    );
    const recap = executiveMateriality(item("Festival de Reels ganha data", 1));
    expect(fine).toBeGreaterThan(recap);
  });

  it("gives lab announcements a small baseline without inventing importance", () => {
    expect(executiveMateriality(item("Notes from the lab", 1, "official"))).toBe(1);
    expect(executiveMateriality(item("Notes from the lab", 1))).toBe(0);
  });
});

describe("compareByEditorialRank", () => {
  it("prefers material news over a newer but empty recap", () => {
    const newer = item("Festival de Reels ganha data", 1);
    const older = item("UE regula modelos de uso geral", 200);
    const publishedTime = (entry: NewsItem) => Date.parse(entry.publishedAt);
    expect(compareByEditorialRank(newer, older, publishedTime)).toBeGreaterThan(0);
  });
});
