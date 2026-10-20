import { afterEach, describe, it, expect, vi } from "vitest";
import { calendarDateBrt, inferSlot } from "./timezone.js";

describe("timezone BRT", () => {
  it("uses the São Paulo calendar date, not UTC", () => {
    const lateUtc = new Date("2026-08-15T02:00:00.000Z");
    expect(calendarDateBrt(lateUtc)).toBe("2026-08-14");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("infers the daily edition at any hour and never labels one meio-dia or tarde", () => {
    vi.useFakeTimers();
    // One edition a day: a late manual run is still that day's edition, not a new afternoon
    // slot that would quietly bring the second daily edition back.
    for (const at of ["07:30", "11:59", "16:30", "21:30"]) {
      vi.setSystemTime(new Date(`2026-08-14T${at}:00.000-03:00`));
      expect(inferSlot()).toBe("manha");
    }
  });
});
