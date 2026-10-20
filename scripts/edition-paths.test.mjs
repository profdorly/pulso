/**
 * The edition URL rule lives in three places that cannot import one another: the reader
 * (`frontend/src/lib/editionPaths.ts`), the scripts (`scripts/lib/edition-paths.mjs`) and the
 * kitchen's index writer (`backend/src/edition/paths.ts`). One table, three implementations, the
 * same answers — so a copy edited alone fails here instead of on the published site.
 *
 * The TypeScript files are imported straight from source: Node strips the types itself.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as scripts from "./lib/edition-paths.mjs";

const reader = await import("../frontend/src/lib/editionPaths.ts");
const kitchen = await import("../backend/src/edition/paths.ts");

/** [calendarDate, slot, router path of the edition] */
const CASES = [
  ["2026-08-25", "manha", "/2026-08-25/manha"],
  ["2026-10-08", "tarde", "/2026-10-08/tarde"],
  // DAILY_SINCE itself is already a daily day.
  ["2026-10-09", "manha", "/2026-10-09"],
  // A forced afternoon run on a daily day keeps its slot.
  ["2026-10-09", "tarde", "/2026-10-09/tarde"],
  ["2026-10-10", "manha", "/2026-10-10"],
  ["2027-01-02", "manha", "/2027-01-02"],
];

describe("edition URL rule", () => {
  it("starts on the same day in every copy", () => {
    assert.equal(scripts.DAILY_SINCE, "2026-10-09");
    assert.equal(reader.DAILY_SINCE, scripts.DAILY_SINCE);
    assert.equal(kitchen.DAILY_SINCE, scripts.DAILY_SINCE);
  });

  for (const [date, slot, expected] of CASES) {
    it(`${date} ${slot} → ${expected}`, () => {
      assert.equal(reader.editionPath(date, slot), expected);
      assert.equal(scripts.editionPath(date, slot), expected);
      assert.equal(kitchen.editionPublicPath(date, slot), `${expected}/`);
      assert.equal(scripts.editionPublicPath(date, slot), `${expected}/`);
    });
  }
});
