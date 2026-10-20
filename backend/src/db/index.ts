import { createDb } from "./client.js";
import { createSchema } from "./schema.js";
import { seedSources } from "./seed.js";
import { createRepositories } from "./repositories/index.js";
import type { Db } from "./client.js";
import type { Repositories } from "./repositories/index.js";

export interface InitializeDbResult {
  db: Db;
  repositories: Repositories;
}

export function initializeDb(env: { DATABASE_PATH: string }): InitializeDbResult {
  const db = createDb({ databasePath: env.DATABASE_PATH });
  createSchema(db);
  seedSources(db);
  const repositories = createRepositories(db);
  return { db, repositories };
}

export type { Db } from "./client.js";
export type { Repositories } from "./repositories/index.js";
