import { describe, expect, it } from "vitest";
import { mergeWeeklyIndex, parseWeeklyIndex, type WeeklyIndex } from "./weeklyIndex.js";

const index = (...weeks: string[]): WeeklyIndex => ({
  schemaVersion: 1,
  latestId: weeks[0] ?? null,
  episodes: weeks.map((weekId) => ({ weekId, path: `weekly/${weekId}/episode.json`, title: weekId })),
});

describe("weekly index", () => {
  it("adds a new episode without hiding the earlier ones, newest first", () => {
    const merged = mergeWeeklyIndex(index("2026-W40"), index("2026-W42"));
    expect(merged.latestId).toBe("2026-W42");
    expect(merged.episodes.map((episode) => episode.weekId)).toEqual(["2026-W42", "2026-W40"]);
  });

  it("replaces a re-published week instead of listing it twice", () => {
    const fixed = { ...index("2026-W40"), episodes: [{ weekId: "2026-W40", path: "weekly/2026-W40/episode.json", title: "corrigido" }] };
    const merged = mergeWeeklyIndex(index("2026-W42", "2026-W40"), fixed);
    expect(merged.episodes.map((episode) => [episode.weekId, episode.title])).toEqual([
      ["2026-W42", "2026-W42"],
      ["2026-W40", "corrigido"],
    ]);
  });

  it("starts from nothing, and refuses a malformed index", () => {
    expect(mergeWeeklyIndex(null, index("2026-W40")).episodes).toHaveLength(1);
    expect(() => parseWeeklyIndex({ schemaVersion: 1, episodes: [{ weekId: "W40" }] }, "x")).toThrow(/inválido/);
  });
});
