import { describe, it, expect } from "vitest";
import { createTestDb } from "./test-helper.js";

describe("createSchema", () => {
  it("creates all required tables idempotently", () => {
    const { db, close } = createTestDb();

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toEqual(
      expect.arrayContaining(["sources", "news_items", "benchmark_snapshots"])
    );
    // Dashboard-era tables are dropped, not merely left unused.
    expect(tableNames).not.toContain("ai_digests");
    expect(tableNames).not.toContain("refresh_runs");

    close();
  });

  it("can run schema creation twice without errors", async () => {
    const { db, close } = createTestDb();
    const { createSchema } = await import("./schema.js");
    createSchema(db);
    createSchema(db);
    close();
  });

  it("migrates a pre-lifecycle database and treats existing rows as already published", async () => {
    const Database = (await import("better-sqlite3")).default;
    const { createSchema, migrateSchema } = await import("./schema.js");
    const db = new Database(":memory:");

    // The kitchen database is carried between runs, so migration has to work against the
    // shape that shipped before the lifecycle columns existed.
    db.exec(`
      CREATE TABLE sources (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, category TEXT NOT NULL,
        region TEXT NOT NULL, feed_url TEXT, homepage TEXT NOT NULL, block TEXT NOT NULL
      );
      CREATE TABLE news_items (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        block TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        author TEXT,
        summary TEXT,
        ai_summary TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        company TEXT,
        region TEXT NOT NULL,
        published_at TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      INSERT INTO news_items (id, source_id, block, title, url, tags, region, published_at, fetched_at)
      VALUES ('legacy', 'openai-news', 'official', 'Legado', 'https://openai.com/news/legacy', '[]', 'us-global',
              '2026-08-13T10:00:00.000Z', '2026-08-13T10:05:00.000Z');
    `);

    migrateSchema(db);

    const columns = (db.prepare("PRAGMA table_info(news_items)").all() as Array<{ name: string }>).map(
      (row) => row.name
    );
    expect(columns).toEqual(
      expect.arrayContaining(["state", "state_reason", "state_changed_at", "attempts"])
    );

    const legacy = db
      .prepare("SELECT state, attempts, region FROM news_items WHERE id = 'legacy'")
      .get() as { state: string; attempts: number; region: string };
    // Already consumed under the old "seen means done" rule — must not replay into an edition.
    expect(legacy.state).toBe("published");
    expect(legacy.attempts).toBe(0);
    // Region split: `us-global` cannot be balanced against Europe or Asia, so stored rows are
    // rewritten once rather than normalized at every read.
    expect(legacy.region).toBe("us");

    // Idempotent: running the full creation path afterwards changes nothing.
    createSchema(db);
    migrateSchema(db);
    const stillPublished = db
      .prepare("SELECT state, region FROM news_items WHERE id = 'legacy'")
      .get() as { state: string; region: string };
    expect(stillPublished.state).toBe("published");
    expect(stillPublished.region).toBe("us");

    db.close();
  });

  it("rewrites every legacy region value and leaves current ones alone", async () => {
    const Database = (await import("better-sqlite3")).default;
    const { createSchema, migrateSchema } = await import("./schema.js");
    const db = new Database(":memory:");
    createSchema(db);
    migrateSchema(db);

    // news_items.source_id is a foreign key, so the source has to exist first.
    db.prepare(
      `INSERT INTO sources (id, name, type, category, region, homepage, block)
       VALUES ('openai-news', 'OpenAI News', 'rss', 'official-company', 'us', 'https://openai.com/news', 'official')`
    ).run();

    const insert = db.prepare(`
      INSERT INTO news_items (id, source_id, block, title, url, tags, region, published_at, fetched_at)
      VALUES (@id, 'openai-news', 'official', @id, @url, '[]', @region,
              '2026-08-13T10:00:00.000Z', '2026-08-13T10:05:00.000Z')
    `);
    insert.run({ id: "a", url: "https://e.com/a", region: "us-global" });
    insert.run({ id: "b", url: "https://e.com/b", region: "china" });
    insert.run({ id: "c", url: "https://e.com/c", region: "brazil" });

    migrateSchema(db);

    const rows = db
      .prepare("SELECT id, region FROM news_items ORDER BY id")
      .all() as Array<{ id: string; region: string }>;
    expect(rows).toEqual([
      { id: "a", region: "us" },
      { id: "b", region: "asia" },
      { id: "c", region: "brazil" },
    ]);

    db.close();
  });

  it("runs the full initializeDb path against a pre-lifecycle database file", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const pathMod = await import("node:path");
    const Database = (await import("better-sqlite3")).default;
    const { initializeDb } = await import("./index.js");

    const dir = mkdtempSync(pathMod.join(tmpdir(), "pulso-legacy-db-"));
    const dbPath = pathMod.join(dir, "news.db");

    const seed = new Database(dbPath);
    seed.exec(`
      CREATE TABLE sources (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, category TEXT NOT NULL,
        region TEXT NOT NULL, feed_url TEXT, homepage TEXT NOT NULL, block TEXT NOT NULL
      );
      CREATE TABLE news_items (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, block TEXT NOT NULL, title TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE, author TEXT, summary TEXT, ai_summary TEXT,
        tags TEXT NOT NULL DEFAULT '[]', company TEXT, region TEXT NOT NULL,
        published_at TEXT NOT NULL, fetched_at TEXT NOT NULL
      );
      INSERT INTO news_items (id, source_id, block, title, url, tags, region, published_at, fetched_at)
      VALUES ('legacy', 'openai-news', 'official', 'Legado', 'https://openai.com/news/legacy', '[]',
              'us-global', '2026-08-13T10:00:00.000Z', '2026-08-13T10:05:00.000Z');
    `);
    seed.close();

    try {
      // Regression: creating idx_news_items_state inside createSchema threw "no such column:
      // state" here, because CREATE TABLE IF NOT EXISTS does not add columns to an existing
      // table. Every real run against the carried-over kitchen database hit this.
      const { db, repositories } = initializeDb({ DATABASE_PATH: dbPath });
      expect(repositories.newsItems.findByUrl("https://openai.com/news/legacy")?.state).toBe(
        "published"
      );
      const indexes = (
        db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{
          name: string;
        }>
      ).map((row) => row.name);
      expect(indexes).toContain("idx_news_items_state");
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
