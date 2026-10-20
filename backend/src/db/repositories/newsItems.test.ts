import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "../test-helper.js";
import type { NewsItem } from "../../types.js";

function makeItem(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: "item-1",
    sourceId: "openai-news",
    block: "official",
    title: "Test title",
    url: "https://example.com/article-1",
    author: "Author",
    summary: "Summary",
    aiSummary: undefined,
    tags: ["ai"],
    company: undefined,
    region: "us",
    publishedAt: "2026-08-14T12:00:00.000Z",
    fetchedAt: "2026-08-14T12:00:00.000Z",
    ...overrides,
  };
}

describe("newsItems repository", () => {
  let testDb: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it("inserts and retrieves a news item, defaulting to the discovered state", () => {
    const item = makeItem();
    testDb.repositories.newsItems.upsert(item);
    const found = testDb.repositories.newsItems.findById(item.id);
    expect(found).toEqual({ ...item, state: "discovered", attempts: 0 });
  });

  it("keeps lifecycle state and attempts across a content re-upsert", () => {
    const item = makeItem();
    testDb.repositories.newsItems.upsert(item);
    testDb.repositories.newsItems.markState(item.url, "retryable", "network");

    testDb.repositories.newsItems.upsert({ ...item, title: "Updated title" });

    const found = testDb.repositories.newsItems.findByUrl(item.url);
    expect(found?.title).toBe("Updated title");
    expect(found?.state).toBe("retryable");
    expect(found?.stateReason).toBe("network");
    expect(found?.attempts).toBe(1);
  });

  it("bumps attempts only for retryable transitions", () => {
    const item = makeItem();
    testDb.repositories.newsItems.upsert(item);

    testDb.repositories.newsItems.markState(item.url, "retryable", "network");
    testDb.repositories.newsItems.markState(item.url, "retryable", "network");
    expect(testDb.repositories.newsItems.findByUrl(item.url)?.attempts).toBe(2);

    testDb.repositories.newsItems.markState(item.url, "retryable", "cap", undefined, false);
    expect(testDb.repositories.newsItems.findByUrl(item.url)?.attempts).toBe(2);

    testDb.repositories.newsItems.markState(item.url, "published", undefined, undefined, false);
    expect(testDb.repositories.newsItems.findByUrl(item.url)?.attempts).toBe(2);
    expect(testDb.repositories.newsItems.findByUrl(item.url)?.state).toBe("published");
  });

  it("returns retryable items under the attempt ceiling and excludes exhausted ones", () => {
    const fresh = makeItem({ id: "fresh", url: "https://example.com/fresh" });
    const exhausted = makeItem({ id: "exhausted", url: "https://example.com/exhausted" });
    const published = makeItem({ id: "done", url: "https://example.com/done" });
    for (const item of [fresh, exhausted, published]) {
      testDb.repositories.newsItems.upsert(item);
    }

    testDb.repositories.newsItems.markState(fresh.url, "retryable", "network");
    for (let i = 0; i < 3; i += 1) {
      testDb.repositories.newsItems.markState(exhausted.url, "retryable", "network");
    }
    testDb.repositories.newsItems.markState(published.url, "published", undefined, undefined, false);

    const retryable = testDb.repositories.newsItems.findRetryable(3, 10);
    expect(retryable.map((row) => row.url)).toEqual([fresh.url]);
  });

  it("deduplicates by url on upsert", () => {
    const item = makeItem();
    testDb.repositories.newsItems.upsert(item);
    testDb.repositories.newsItems.upsert({ ...item, title: "Updated title" });

    const all = testDb.repositories.newsItems.findByBlock("official");
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("Updated title");
  });

  it("inserts many items", () => {
    const items: NewsItem[] = [
      makeItem({ id: "a", url: "https://example.com/a" }),
      makeItem({ id: "b", url: "https://example.com/b" }),
    ];
    testDb.repositories.newsItems.insertMany(items);
    expect(testDb.repositories.newsItems.count()).toBe(2);
  });

  it("finds items by block ordered newest first", () => {
    const older = makeItem({
      id: "older",
      url: "https://example.com/older",
      publishedAt: "2026-08-13T12:00:00.000Z",
    });
    const newer = makeItem({
      id: "newer",
      url: "https://example.com/newer",
      publishedAt: "2026-08-14T12:00:00.000Z",
    });
    testDb.repositories.newsItems.insertMany([older, newer]);
    const found = testDb.repositories.newsItems.findByBlock("official");
    expect(found[0].id).toBe("newer");
    expect(found[1].id).toBe("older");
  });

  it("finds an item by url", () => {
    const item = makeItem();
    testDb.repositories.newsItems.upsert(item);
    const found = testDb.repositories.newsItems.findByUrl(item.url);
    expect(found?.id).toBe(item.id);
  });

  it("returns recent items across blocks", () => {
    const item = makeItem();
    testDb.repositories.newsItems.upsert(item);
    const recent = testDb.repositories.newsItems.findRecent(10);
    expect(recent).toHaveLength(1);
  });

  it("returns all items", () => {
    testDb.repositories.newsItems.upsert(makeItem({ id: "a", url: "https://example.com/a" }));
    testDb.repositories.newsItems.upsert(
      makeItem({ id: "b", url: "https://example.com/b", block: "impartial" })
    );
    expect(testDb.repositories.newsItems.findAll()).toHaveLength(2);
  });

  it("forgets only the items no fetch has seen since the cutoff", () => {
    const stale = makeItem({ id: "stale", url: "https://example.com/stale", fetchedAt: "2026-06-01T00:00:00.000Z" });
    const seenAgain = makeItem({ id: "again", url: "https://example.com/again", fetchedAt: "2026-06-01T00:00:00.000Z" });
    testDb.repositories.newsItems.upsert(stale);
    testDb.repositories.newsItems.upsert(seenAgain);
    // A later fetch of the same url refreshes fetched_at, so it survives.
    testDb.repositories.newsItems.upsert({ ...seenAgain, fetchedAt: "2026-10-01T00:00:00.000Z" });

    expect(testDb.repositories.newsItems.pruneNotSeenSince("2026-07-01T00:00:00.000Z")).toBe(1);
    expect(testDb.repositories.newsItems.findAll().map((item) => item.id)).toEqual(["again"]);
  });

  it("marks items as seen again without touching content or lifecycle", () => {
    testDb.repositories.newsItems.upsert(makeItem({ fetchedAt: "2026-06-01T00:00:00.000Z" }));
    testDb.repositories.newsItems.markState("https://example.com/article-1", "published", undefined, "2026-06-01T00:00:00.000Z", false);

    expect(testDb.repositories.newsItems.touchSeen(["https://example.com/article-1", "https://example.com/unknown"], "2026-10-01T00:00:00.000Z")).toBe(1);
    const item = testDb.repositories.newsItems.findByUrl("https://example.com/article-1");
    expect(item).toMatchObject({ fetchedAt: "2026-10-01T00:00:00.000Z", state: "published", title: "Test title" });
    // Never moves backwards.
    expect(testDb.repositories.newsItems.touchSeen(["https://example.com/article-1"], "2026-09-01T00:00:00.000Z")).toBe(0);
  });
});
