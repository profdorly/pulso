import path from "node:path";
import { describe, expect, it } from "vitest";
import { DAILY_SINCE, editionFileName, editionPublicPath } from "./paths.js";

describe("editionPublicPath", () => {
  it("keeps the slot for every edition before the daily journal", () => {
    expect(editionPublicPath("2026-10-08", "manha")).toBe("/2026-10-08/manha/");
    expect(editionPublicPath("2026-10-08", "tarde")).toBe("/2026-10-08/tarde/");
    expect(editionPublicPath("2026-08-25", "meio-dia")).toBe("/2026-08-25/meio-dia/");
  });

  it("addresses the daily edition by its date alone from DAILY_SINCE on", () => {
    expect(DAILY_SINCE).toBe("2026-10-09");
    expect(editionPublicPath(DAILY_SINCE, "manha")).toBe("/2026-10-09/");
    expect(editionPublicPath("2026-11-02", "manha")).toBe("/2026-11-02/");
  });

  it("keeps the slot for a forced afternoon edition on a daily day", () => {
    expect(editionPublicPath(DAILY_SINCE, "tarde")).toBe("/2026-10-09/tarde/");
  });

  it("does not move the data file of a daily edition", () => {
    expect(editionFileName(DAILY_SINCE, "manha")).toBe(path.join("2026-10-09", "manha.json"));
  });
});
