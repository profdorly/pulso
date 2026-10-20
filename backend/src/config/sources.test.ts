import { describe, it, expect } from "vitest";
import { REGIONS } from "../types.js";
import { SOURCES, getSourcesByBlock, getSourceById, getRssSources } from "./sources.js";

describe("SOURCE REGISTRY", () => {
  it("contains all official company RSS sources", () => {
    const official = getSourcesByBlock("official");
    const names = official.map((s) => s.name);
    // Microsoft Azure left by measurement (research/feed-pruning.md): corporate PR, not news.
    expect(official).toHaveLength(8);
    expect(names).toEqual(
      expect.arrayContaining([
        "OpenAI News",
        "Google DeepMind",
        "Google AI Blog",
        "Google Gemini",
        "Google Research",
        "Meta Newsroom",
        "Hugging Face Blog",
        "Mistral AI",
      ])
    );
    expect(official.every((s) => s.type === "rss" && s.category === "official-company")).toBe(true);
  });

  it("covers every editorial region with impartial media, not just Brazil", () => {
    const impartial = getSourcesByBlock("impartial");

    // Every region must be represented, otherwise the geographic quota has nothing to draw
    // from and the edition falls back to whichever region publishes most often.
    const byRegion = new Map<string, number>();
    for (const source of impartial) {
      byRegion.set(source.region, (byRegion.get(source.region) ?? 0) + 1);
    }

    for (const region of REGIONS) {
      expect(byRegion.get(region) ?? 0).toBeGreaterThan(0);
    }
    // Brazil must not dominate the pool: recency alone already favours it, since local
    // outlets publish more often and in the same timezone the edition runs in.
    const brazil = byRegion.get("brazil") ?? 0;
    for (const region of REGIONS) {
      if (region === "brazil") continue;
      expect(byRegion.get(region) ?? 0).toBeGreaterThanOrEqual(brazil);
    }
  });

  it("lists only feeds: feed-less labs are the web search's job", () => {
    expect(SOURCES.every((s) => s.type === "rss")).toBe(true);
  });

  it("every source has required fields", () => {
    for (const source of SOURCES) {
      expect(source.id).toBeTruthy();
      expect(source.name).toBeTruthy();
      expect(source.type).toBe("rss");
      expect(source.category).toBeTruthy();
      expect(REGIONS).toContain(source.region);
      expect(source.homepage).toMatch(/^https?:\/\//);
      expect(source.block).toBeTruthy();
      if (source.type === "rss") {
        expect(source.feedUrl).toMatch(/^https?:\/\//);
      }
    }
  });

  it("source ids are unique", () => {
    const ids = SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getSourceById returns the correct source", () => {
    const source = getSourceById("openai-news");
    expect(source?.name).toBe("OpenAI News");
    expect(getSourceById("not-real")).toBeUndefined();
  });

  it("getRssSources returns only rss sources", () => {
    const rss = getRssSources();
    expect(rss.length).toBe(SOURCES.length);
    expect(rss.every((s) => s.type === "rss")).toBe(true);
  });

  it("sources are seeded into the database", async () => {
    const { createTestDb } = await import("../db/test-helper.js");
    const { db, close } = createTestDb();
    const seeded = db
      .prepare("SELECT id FROM sources ORDER BY id")
      .all() as Array<{ id: string }>;
    expect(seeded.length).toBe(SOURCES.length);
    expect(seeded.map((s) => s.id)).toEqual(SOURCES.map((s) => s.id).sort());
    close();
  });
});
