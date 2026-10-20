import type { Db } from "../client.js";
import type { CandidateState, NewsItem } from "../../types.js";

export interface NewsItemRow {
  id: string;
  source_id: string;
  block: string;
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  ai_summary: string | null;
  tags: string;
  company: string | null;
  region: string;
  published_at: string;
  fetched_at: string;
  state: string | null;
  state_reason: string | null;
  state_changed_at: string | null;
  attempts: number | null;
}

function rowToNewsItem(row: NewsItemRow): NewsItem {
  const item: NewsItem = {
    id: row.id,
    sourceId: row.source_id,
    block: row.block as NewsItem["block"],
    title: row.title,
    url: row.url,
    author: row.author ?? undefined,
    summary: row.summary ?? undefined,
    aiSummary: row.ai_summary ?? undefined,
    tags: JSON.parse(row.tags) as string[],
    company: row.company ?? undefined,
    region: row.region as NewsItem["region"],
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    state: (row.state ?? "discovered") as CandidateState,
    attempts: row.attempts ?? 0,
  };
  if (row.state_reason) item.stateReason = row.state_reason;
  if (row.state_changed_at) item.stateChangedAt = row.state_changed_at;
  return item;
}

type NewsItemContentRow = Omit<
  NewsItemRow,
  "state" | "state_reason" | "state_changed_at" | "attempts"
>;

function newsItemToRow(item: NewsItem): NewsItemContentRow {
  return {
    id: item.id,
    source_id: item.sourceId,
    block: item.block,
    title: item.title,
    url: item.url,
    author: item.author ?? null,
    summary: item.summary ?? null,
    ai_summary: item.aiSummary ?? null,
    tags: JSON.stringify(item.tags),
    company: item.company ?? null,
    region: item.region,
    published_at: item.publishedAt,
    fetched_at: item.fetchedAt,
  };
}

export function createNewsItemsRepository(db: Db) {
  const insert = db.prepare<NewsItemContentRow>(`
    INSERT OR IGNORE INTO news_items (
      id, source_id, block, title, url, author, summary, ai_summary, tags, company, region, published_at, fetched_at,
      state, state_reason, state_changed_at, attempts
    ) VALUES (
      @id, @source_id, @block, @title, @url, @author, @summary, @ai_summary, @tags, @company, @region, @published_at, @fetched_at,
      'discovered', NULL, NULL, 0
    )
  `);

  const insertMany = db.transaction((items: NewsItem[]) => {
    for (const item of items) {
      insert.run(newsItemToRow(item));
    }
  });

  /**
   * Content upsert. Deliberately does NOT touch the lifecycle columns: a re-fetch of an
   * item already marked `rejected` or `published` must not resurrect it, and a retry
   * must not reset its attempt count.
   */
  const upsertStatement = db.prepare(`
    INSERT INTO news_items (
      id, source_id, block, title, url, author, summary, ai_summary, tags, company, region, published_at, fetched_at,
      state, state_reason, state_changed_at, attempts
    ) VALUES (
      @id, @source_id, @block, @title, @url, @author, @summary, @ai_summary, @tags, @company, @region, @published_at, @fetched_at,
      'discovered', NULL, NULL, 0
    )
    ON CONFLICT(url) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      summary = excluded.summary,
      ai_summary = excluded.ai_summary,
      tags = excluded.tags,
      company = excluded.company,
      region = excluded.region,
      published_at = excluded.published_at,
      fetched_at = excluded.fetched_at
  `);

  const markStateStatement = db.prepare<{
    url: string;
    state: string;
    reason: string | null;
    changed_at: string;
    bump: number;
  }>(`
    UPDATE news_items
    SET state = @state,
        state_reason = @reason,
        state_changed_at = @changed_at,
        attempts = attempts + @bump
    WHERE url = @url
  `);

  return {
    upsert(item: NewsItem): { changes: number; lastInsertRowid: number | bigint } {
      const result = upsertStatement.run(newsItemToRow(item));
      return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
    },

    insertMany(items: NewsItem[]): void {
      insertMany(items);
    },

    /**
     * Records a lifecycle transition. `retryable` bumps the attempt counter so an item
     * that keeps failing can eventually be given up on instead of retried forever.
     */
    markState(
      url: string,
      state: CandidateState,
      reason?: string,
      changedAt = new Date().toISOString(),
      bumpAttempts = state === "retryable"
    ): void {
      markStateStatement.run({
        url,
        state,
        reason: reason ?? null,
        changed_at: changedAt,
        bump: bumpAttempts ? 1 : 0,
      });
    },

    /** Items eligible to be reconsidered, oldest failure first. */
    findRetryable(maxAttempts: number, limit: number): NewsItem[] {
      const rows = db
        .prepare<{ maxAttempts: number; limit: number }>(`
          SELECT * FROM news_items
          WHERE state = 'retryable' AND attempts < @maxAttempts
          ORDER BY state_changed_at ASC, published_at DESC
          LIMIT @limit
        `)
        .all({ maxAttempts, limit }) as NewsItemRow[];
      return rows.map(rowToNewsItem);
    },

    countByState(): Record<string, number> {
      const rows = db
        .prepare(`SELECT state, COUNT(*) as count FROM news_items GROUP BY state`)
        .all() as Array<{ state: string | null; count: number }>;
      const counts: Record<string, number> = {};
      for (const row of rows) {
        counts[row.state ?? "discovered"] = row.count;
      }
      return counts;
    },

    findByBlock(block: string): NewsItem[] {
      const rows = db
        .prepare<Pick<NewsItemRow, "block">>(`
          SELECT * FROM news_items
          WHERE block = @block
          ORDER BY published_at DESC, fetched_at DESC
        `)
        .all({ block }) as NewsItemRow[];
      return rows.map(rowToNewsItem);
    },

    findById(id: string): NewsItem | undefined {
      const row = db
        .prepare<Pick<NewsItemRow, "id">>(`SELECT * FROM news_items WHERE id = @id`)
        .get({ id }) as NewsItemRow | undefined;
      return row ? rowToNewsItem(row) : undefined;
    },

    findByUrl(url: string): NewsItem | undefined {
      const row = db
        .prepare<Pick<NewsItemRow, "url">>(`SELECT * FROM news_items WHERE url = @url`)
        .get({ url }) as NewsItemRow | undefined;
      return row ? rowToNewsItem(row) : undefined;
    },

    findAll(): NewsItem[] {
      const rows = db
        .prepare(`
          SELECT * FROM news_items
          ORDER BY published_at DESC, fetched_at DESC
        `)
        .all() as NewsItemRow[];
      return rows.map(rowToNewsItem);
    },

    findRecent(limit: number): NewsItem[] {
      const rows = db
        .prepare<{ limit: number }>(`
          SELECT * FROM news_items
          ORDER BY published_at DESC, fetched_at DESC
          LIMIT @limit
        `)
        .all({ limit }) as NewsItemRow[];
      return rows.map(rowToNewsItem);
    },

    count(): number {
      const result = db.prepare(`SELECT COUNT(*) as count FROM news_items`).get() as {
        count: number;
      };
      return result.count;
    },

    /**
     * Forgets items no feed has shown since `cutoff`. `fetched_at` moves on every re-fetch, so
     * this only drops what has left every feed: dedupe needs to remember what can still come
     * back, not the whole history. Returns how many rows went.
     */
    pruneNotSeenSince(cutoff: string): number {
      return db.prepare<{ cutoff: string }>(`DELETE FROM news_items WHERE fetched_at < @cutoff`).run({ cutoff }).changes;
    },

    /**
     * Records that a fetch saw these URLs again, without touching content or lifecycle. The
     * edition skips items already published or rejected before any upsert, so without this their
     * `fetched_at` would freeze and the retention prune would forget items a feed still lists —
     * and an undated one would come back as news.
     */
    touchSeen(urls: readonly string[], at: string): number {
      const touch = db.prepare<{ url: string; at: string }>(
        `UPDATE news_items SET fetched_at = @at WHERE url = @url AND fetched_at < @at`
      );
      let changed = 0;
      db.transaction(() => {
        for (const url of urls) changed += touch.run({ url, at }).changes;
      })();
      return changed;
    },

    clear(): void {
      db.exec(`DELETE FROM news_items`);
    },
  };
}

export type NewsItemsRepository = ReturnType<typeof createNewsItemsRepository>;
