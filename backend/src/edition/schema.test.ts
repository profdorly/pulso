import { describe, expect, it } from "vitest";
import { pulsoItemSchema, regionSchema } from "./schema.js";

const item = {
  id: "a",
  title: "GLM-5.3 chega",
  url: "https://pandaily.com/glm-5-3",
  outlet: "Pandaily",
  kind: "press" as const,
  publishedAt: "2026-08-14T14:10:00.000Z",
  firstSeenAt: "2026-08-14T15:32:00.000Z",
};

describe("regionSchema", () => {
  it("keeps archived editions readable after the region split", () => {
    // Covers already published under the old vocabulary must not become unparseable, or the
    // whole archive breaks the day the regions change.
    expect(regionSchema.parse("us-global")).toBe("us");
    expect(regionSchema.parse("china")).toBe("asia");
  });

  it("passes current values through", () => {
    expect(regionSchema.parse("europe")).toBe("europe");
    expect(regionSchema.parse("brazil")).toBe("brazil");
  });

  it("rejects a value it cannot place instead of mislabelling it", () => {
    expect(() => regionSchema.parse("mars")).toThrow();
  });
});

describe("pulsoItemSchema", () => {
  it("normalizes a legacy region on an archived item", () => {
    const parsed = pulsoItemSchema.parse({ ...item, region: "china" });
    expect(parsed.region).toBe("asia");
  });

  it("accepts an item written with the current regions", () => {
    const parsed = pulsoItemSchema.parse({ ...item, region: "asia" });
    expect(parsed.region).toBe("asia");
  });
});
