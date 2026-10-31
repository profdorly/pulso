import type { Db } from "../client.js";
import { createNewsItemsRepository } from "./newsItems.js";
import { createBenchmarkSnapshotsRepository } from "./benchmarkSnapshots.js";

export function createRepositories(db: Db) {
  return {
    newsItems: createNewsItemsRepository(db),
    benchmarkSnapshots: createBenchmarkSnapshotsRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
