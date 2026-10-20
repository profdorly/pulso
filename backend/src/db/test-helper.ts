import { createDb } from "./client.js";
import { createSchema } from "./schema.js";
import { seedSources } from "./seed.js";
import { createRepositories } from "./repositories/index.js";
import type { Db } from "./client.js";
import type { Repositories } from "./repositories/index.js";

export interface TestDb {
  db: Db;
  repositories: Repositories;
  close: () => void;
}

export function createTestDb(): TestDb {
  const db = createDb({ databasePath: ":memory:" });
  createSchema(db);
  seedSources(db);
  const repositories = createRepositories(db);
  return {
    db,
    repositories,
    close: () => db.close(),
  };
}
