import type { Db } from "./client.js";

export function createSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      region TEXT NOT NULL,
      feed_url TEXT,
      homepage TEXT NOT NULL,
      block TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS news_items (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
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
      fetched_at TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'discovered',
      state_reason TEXT,
      state_changed_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_news_items_block ON news_items(block);
    CREATE INDEX IF NOT EXISTS idx_news_items_source_id ON news_items(source_id);
    CREATE INDEX IF NOT EXISTS idx_news_items_published_at ON news_items(published_at);
    -- The state index is created in migrateSchema, after the column is guaranteed to exist.
    -- Creating it here would fail against a database predating the lifecycle columns, since
    -- CREATE TABLE IF NOT EXISTS is a no-op for that table.

    CREATE TABLE IF NOT EXISTS benchmark_snapshots (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_benchmark_snapshots_captured_at ON benchmark_snapshots(captured_at);

    -- The editions directory, carried inside the database so the kitchen's state is one file:
    -- one atomic upload per run, instead of a database and a folder that could disagree.
    CREATE TABLE IF NOT EXISTS artifacts (
      path TEXT PRIMARY KEY,
      body BLOB NOT NULL,
      sha256 TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  migrateSchema(db);
}

interface ColumnInfo {
  name: string;
}

function columnNames(db: Db, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
  return new Set(rows.map((row) => row.name));
}

/**
 * Additive, idempotent migrations for databases created before a column existed.
 *
 * The kitchen database is carried between runs (downloaded, written back), so a schema change
 * has to work against an existing file, not just a fresh one.
 */
export function migrateSchema(db: Db): void {
  const newsColumns = columnNames(db, "news_items");

  if (!newsColumns.has("state")) {
    // Pre-existing rows were already consumed by an edition under the old "seen means
    // done" rule. Marking them `published` keeps their dedupe behaviour identical
    // instead of replaying the whole archive into the next edition.
    db.exec(`ALTER TABLE news_items ADD COLUMN state TEXT`);
    db.exec(`UPDATE news_items SET state = 'published' WHERE state IS NULL`);
  }
  if (!newsColumns.has("state_reason")) {
    db.exec(`ALTER TABLE news_items ADD COLUMN state_reason TEXT`);
  }
  if (!newsColumns.has("state_changed_at")) {
    db.exec(`ALTER TABLE news_items ADD COLUMN state_changed_at TEXT`);
  }
  if (!newsColumns.has("attempts")) {
    db.exec(`ALTER TABLE news_items ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`);
  }

  db.exec(`UPDATE news_items SET state = 'published' WHERE state IS NULL OR state = ''`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_news_items_state ON news_items(state)`);

  // Region split: `us-global` meant "the US plus everywhere we did not think about", which
  // cannot be balanced against Europe or Asia. Rewriting stored rows keeps the quota reading
  // one vocabulary instead of normalizing at every call site. Idempotent by construction —
  // the old values no longer exist after the first pass.
  db.exec(`UPDATE news_items SET region = 'us' WHERE region = 'us-global'`);
  db.exec(`UPDATE news_items SET region = 'asia' WHERE region = 'china'`);

  // Leftovers of the dashboard era: nothing has written to these since the edition pipeline.
  db.exec(`DROP TABLE IF EXISTS ai_digests`);
  db.exec(`DROP TABLE IF EXISTS refresh_runs`);
}
