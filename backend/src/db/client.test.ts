import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb } from "./client.js";
import { createSchema } from "./schema.js";
import { existsSync } from "node:fs";
import { rmSync } from "node:fs";

describe("createDb", () => {
  const testDbPath = "/tmp/ai-news-dashboard-client-test.db";

  beforeEach(() => {
    if (existsSync(testDbPath)) {
      rmSync(testDbPath);
    }
  });

  afterEach(() => {
    if (existsSync(testDbPath)) {
      rmSync(testDbPath);
    }
  });

  it("creates a file-backed database when given a path", () => {
    const db = createDb({ databasePath: testDbPath });
    createSchema(db);
    db.close();
    expect(existsSync(testDbPath)).toBe(true);
  });

  it("creates an in-memory database for :memory:", () => {
    const db = createDb({ databasePath: ":memory:" });
    createSchema(db);
    const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    expect(result.map((r) => r.name)).toContain("sources");
    db.close();
  });
});
