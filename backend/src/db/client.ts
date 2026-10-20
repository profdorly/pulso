import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type Db = Database.Database;

export interface DbClientOptions {
  databasePath: string;
  verbose?: boolean;
}

export function createDb(options: DbClientOptions): Db {
  const path = options.databasePath === ":memory:" ? ":memory:" : resolve(options.databasePath);

  if (path !== ":memory:") {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(path, {
    verbose: options.verbose ? console.log : undefined,
  });

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return db;
}
