import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../db/test-helper.js";
import { captureArtifacts, clearArtifacts, materializeArtifacts } from "./artifacts.js";

function write(dir: string, relative: string, body: string): void {
  mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
  writeFileSync(path.join(dir, relative), body);
}

describe("kitchen artifacts", () => {
  let dir: string;
  let testDb: TestDb;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "pulso-artifacts-"));
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips the editions directory through the database", () => {
    const source = path.join(dir, "a");
    write(source, "index.json", "{\"editions\":[]}");
    write(source, "2026-10-09/manha.json", "{\"id\":1}");
    write(source, "2026-10-09/manha.cover-r1.svg", "<svg/>");
    write(source, "2026-10-09/manha.cover-r1.html", "<html/>");
    write(source, "edition.lock", "pid");

    expect(captureArtifacts(testDb.db, source).sort()).toEqual([
      "2026-10-09/manha.cover-r1.svg",
      "2026-10-09/manha.json",
      "index.json",
    ]);

    const restored = path.join(dir, "b");
    write(restored, "leftover.json", "{}");
    expect(materializeArtifacts(testDb.db, restored)).toBe(3);
    expect(readFileSync(path.join(restored, "2026-10-09", "manha.json"), "utf8")).toBe("{\"id\":1}");
    expect(() => readFileSync(path.join(restored, "leftover.json"))).toThrow();
  });

  it("writes only what changed since the last capture", () => {
    write(dir, "index.json", "1");
    write(dir, "models.json", "m");
    captureArtifacts(testDb.db, dir);

    write(dir, "index.json", "2");
    write(dir, "2026-10-10/manha.json", "new");
    expect(captureArtifacts(testDb.db, dir).sort()).toEqual(["2026-10-10/manha.json", "index.json"]);
    expect(captureArtifacts(testDb.db, dir)).toEqual([]);
  });

  it("refuses a stored path that would land outside the directory", () => {
    testDb.db
      .prepare("INSERT INTO artifacts (path, body, sha256, updated_at) VALUES (?, ?, ?, ?)")
      .run("../escape.json", Buffer.from("x"), "h", "t");
    expect(() => materializeArtifacts(testDb.db, path.join(dir, "out"))).toThrow(/escapes/);
  });

  it("empties the table for an import that starts over", () => {
    write(dir, "index.json", "1");
    captureArtifacts(testDb.db, dir);
    clearArtifacts(testDb.db);
    expect(materializeArtifacts(testDb.db, path.join(dir, "out"))).toBe(0);
  });
});
