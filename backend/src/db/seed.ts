import type { Db } from "./client.js";
import { SOURCES } from "../config/sources.js";

export function seedSources(db: Db): void {
  const insert = db.prepare(`
    INSERT INTO sources (id, name, type, category, region, feed_url, homepage, block)
    VALUES (@id, @name, @type, @category, @region, @feedUrl, @homepage, @block)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      category = excluded.category,
      region = excluded.region,
      feed_url = excluded.feed_url,
      homepage = excluded.homepage,
      block = excluded.block
  `);

  const seed = db.transaction(() => {
    for (const source of SOURCES) {
      insert.run({
        id: source.id,
        name: source.name,
        type: source.type,
        category: source.category,
        region: source.region,
        feedUrl: source.feedUrl ?? null,
        homepage: source.homepage,
        block: source.block,
      });
    }
  });

  seed();
}
