import { describe, expect, it } from "vitest";
import { REGIONS, emptyRegionCounts, isRegion, normalizeRegion } from "./types.js";

describe("regions", () => {
  it("covers the continents the edition is balanced across", () => {
    expect([...REGIONS]).toEqual(["brazil", "us", "europe", "asia"]);
  });

  it("maps the values written before the split", () => {
    // Stored rows and published artifacts still carry these.
    expect(normalizeRegion("us-global")).toBe("us");
    expect(normalizeRegion("china")).toBe("asia");
  });

  it("passes current values through unchanged", () => {
    for (const region of REGIONS) {
      expect(normalizeRegion(region)).toBe(region);
    }
  });

  it("refuses to guess a region for an unrecognized value", () => {
    // Region drives editorial balance, so a silent wrong bucket would skew the very thing it
    // exists to guarantee. Better to fail than to file an item under the wrong continent.
    expect(normalizeRegion("latam")).toBeUndefined();
    expect(normalizeRegion("")).toBeUndefined();
    expect(normalizeRegion(undefined)).toBeUndefined();
    expect(normalizeRegion(42)).toBeUndefined();
  });

  it("narrows only current values with isRegion", () => {
    expect(isRegion("europe")).toBe(true);
    expect(isRegion("china")).toBe(false);
    expect(isRegion("us-global")).toBe(false);
  });

  it("starts a tally with every bucket present", () => {
    const counts = emptyRegionCounts();
    expect(Object.keys(counts).sort()).toEqual([...REGIONS].sort());
    expect(Object.values(counts).every((value) => value === 0)).toBe(true);
  });
});
