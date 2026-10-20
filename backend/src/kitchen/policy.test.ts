import { describe, expect, it } from "vitest";
import { createTestDb } from "../db/test-helper.js";
import type { EditionJobResult } from "../edition/schema.js";
import { catalogueDue, compactState, retentionCutoff, shouldPublishSite } from "./policy.js";

function result(overrides: Partial<EditionJobResult>): EditionJobResult {
  return { status: "published", editionId: "2026-10-19-manha", newItemCount: 12, costUsdApprox: 0.3, ...overrides };
}

describe("shouldPublishSite", () => {
  it("publishes when the run wrote an edition or the catalogue", () => {
    expect(shouldPublishSite(result({}))).toBe(true);
    expect(shouldPublishSite(result({ status: "partial" }))).toBe(true);
    // The honest empty edition, written once the last cover went stale.
    expect(shouldPublishSite(result({ newItemCount: 0 }))).toBe(true);
  });

  it("leaves the site alone when nothing new was written", () => {
    expect(shouldPublishSite(result({ status: "unchanged", newItemCount: 0, skippedReason: "no-delta" }))).toBe(false);
    expect(shouldPublishSite(result({ status: "error", error: "x" }))).toBe(false);
  });
});

describe("catalogueDue", () => {
  const monday = new Date("2026-10-26T10:30:00Z");
  it("captures on Monday, once", () => {
    expect(catalogueDue("2026-10-19T10:31:00Z", monday)).toBe(true);
    expect(catalogueDue("2026-10-26T10:31:00Z", new Date("2026-10-26T12:40:00Z"))).toBe(false);
  });

  it("does not capture mid-week, but retries a Monday that failed", () => {
    expect(catalogueDue("2026-10-19T10:31:00Z", new Date("2026-10-21T10:30:00Z"))).toBe(false);
    // Last good capture a week ago Monday; this Monday's failed, so Tuesday tries again.
    expect(catalogueDue("2026-10-19T10:31:00Z", new Date("2026-10-27T10:30:00Z"))).toBe(true);
  });

  it("captures when there is no catalogue yet", () => {
    expect(catalogueDue(undefined, new Date("2026-10-21T10:30:00Z"))).toBe(true);
  });

  it("reads Monday in Brasília, not in UTC", () => {
    // 01:00 UTC Monday is still Sunday 22:00 in São Paulo.
    expect(catalogueDue("2026-10-19T10:31:00Z", new Date("2026-10-26T01:00:00Z"))).toBe(false);
  });
});

describe("compactState", () => {
  it("forgets items unseen for 90 days and leaves a sound file", () => {
    const now = new Date("2026-10-19T10:30:00Z");
    expect(retentionCutoff(now)).toBe("2026-07-21T10:30:00.000Z");

    const testDb = createTestDb();
    const base = {
      sourceId: "openai-news",
      block: "official" as const,
      title: "t",
      tags: [],
      region: "us" as const,
      publishedAt: "2026-07-01T00:00:00.000Z",
    };
    testDb.repositories.newsItems.upsert({ ...base, id: "old", url: "https://e.com/old", fetchedAt: "2026-07-01T00:00:00.000Z" });
    testDb.repositories.newsItems.upsert({ ...base, id: "new", url: "https://e.com/new", fetchedAt: "2026-10-18T00:00:00.000Z" });

    expect(compactState(testDb.db, testDb.repositories, now)).toBe(1);
    expect(testDb.repositories.newsItems.findAll().map((item) => item.id)).toEqual(["new"]);
    testDb.close();
  });
});
