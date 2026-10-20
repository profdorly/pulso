import { describe, expect, it } from "vitest";
import { sourceRoute } from "./weekly.js";

describe("sourceRoute", () => {
  it("links a story from the twice-daily period where the episode recorded it", () => {
    expect(sourceRoute({ itemPath: "2026-10-01/tarde/noticia/abc" })).toBe("/2026-10-01/tarde/noticia/abc");
    expect(sourceRoute({ itemPath: "2026-10-08/manha/noticia/abc" })).toBe("/2026-10-08/manha/noticia/abc");
  });

  it("links a story from a daily edition at its date-only address", () => {
    expect(sourceRoute({ itemPath: "2026-10-09/manha/noticia/abc" })).toBe("/2026-10-09/noticia/abc");
  });

  it("leaves an address already in the date-only form as it is", () => {
    expect(sourceRoute({ itemPath: "2026-10-09/noticia/abc" })).toBe("/2026-10-09/noticia/abc");
  });
});
