import { describe, expect, it } from "vitest";
import { DAILY_SINCE, editionPath } from "./editionPaths.js";
import { pageRoute } from "./paths.js";

describe("editionPath", () => {
  it("keeps the slot for every edition of the twice-daily period", () => {
    expect(editionPath("2026-10-08", "manha")).toBe("/2026-10-08/manha");
    expect(editionPath("2026-10-08", "tarde")).toBe("/2026-10-08/tarde");
    expect(editionPath("2026-08-25", "meio-dia")).toBe("/2026-08-25/meio-dia");
  });

  it("addresses the daily edition by its date alone, starting on DAILY_SINCE itself", () => {
    expect(DAILY_SINCE).toBe("2026-10-09");
    expect(editionPath("2026-10-09", "manha")).toBe("/2026-10-09");
    expect(editionPath("2026-10-10", "manha")).toBe("/2026-10-10");
    expect(editionPath("2027-01-02", "manha")).toBe("/2027-01-02");
  });

  it("keeps the slot for a forced afternoon run on a daily day", () => {
    expect(editionPath("2026-10-09", "tarde")).toBe("/2026-10-09/tarde");
  });
});

describe("pageRoute", () => {
  it("adds the trailing slash a static host serves a page directory at", () => {
    expect(pageRoute("/2026-10-09")).toBe("/2026-10-09/");
    expect(pageRoute("arquivo/2")).toBe("/arquivo/2/");
    expect(pageRoute("/modelos/")).toBe("/modelos/");
    expect(pageRoute("")).toBe("/");
  });

  it("leaves files alone", () => {
    expect(pageRoute("feed.xml")).toBe("/feed.xml");
    expect(pageRoute("/editions/2026-10-09/manha.cover-r1.og.png")).toBe(
      "/editions/2026-10-09/manha.cover-r1.og.png"
    );
  });
});
