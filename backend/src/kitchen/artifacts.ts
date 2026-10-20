import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Db } from "../db/client.js";

/**
 * The editions directory, stored inside the kitchen database.
 *
 * A run reads and writes plain files (`store.ts`, the cover renderer, the weekly pilot), so the
 * files stay the working format. Between runs they live in the `artifacts` table, which makes the
 * whole kitchen a single SQLite file: downloaded once, uploaded once, and never half-written.
 */

/** What a run produces and the site needs: edition JSON, the index pointers, the catalogue, covers. */
const STORED_EXTENSIONS = new Set([".json", ".svg"]);

function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function listFiles(dir: string, relative = ""): string[] {
  const here = relative ? path.join(dir, relative) : dir;
  const files: string[] = [];
  for (const name of readdirSync(here)) {
    const rel = relative ? `${relative}/${name}` : name;
    if (statSync(path.join(dir, rel)).isDirectory()) files.push(...listFiles(dir, rel));
    else if (STORED_EXTENSIONS.has(path.extname(name))) files.push(rel);
  }
  return files;
}

/** Writes every stored artifact under `dir`, which is emptied first. Returns how many. */
export function materializeArtifacts(db: Db, dir: string): number {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const rows = db.prepare("SELECT path, body FROM artifacts").all() as Array<{ path: string; body: Buffer }>;
  for (const row of rows) {
    const target = path.resolve(dir, row.path);
    if (!target.startsWith(path.resolve(dir) + path.sep)) throw new Error(`artifact path escapes the directory: ${row.path}`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, row.body);
  }
  return rows.length;
}

/** Stores every file under `dir` that is new or changed. Returns the paths it wrote. */
export function captureArtifacts(db: Db, dir: string, now = new Date()): string[] {
  const current = new Map(
    (db.prepare("SELECT path, sha256 FROM artifacts").all() as Array<{ path: string; sha256: string }>).map(
      (row) => [row.path, row.sha256]
    )
  );
  const upsert = db.prepare(
    `INSERT INTO artifacts (path, body, sha256, updated_at) VALUES (@path, @body, @sha256, @updatedAt)
     ON CONFLICT(path) DO UPDATE SET body = excluded.body, sha256 = excluded.sha256, updated_at = excluded.updated_at`
  );
  const changed: string[] = [];
  const store = db.transaction(() => {
    for (const relative of listFiles(dir)) {
      const body = readFileSync(path.join(dir, relative));
      const hash = sha256(body);
      if (current.get(relative) === hash) continue;
      upsert.run({ path: relative, body, sha256: hash, updatedAt: now.toISOString() });
      changed.push(relative);
    }
  });
  store();
  return changed;
}

/** Empties the table, for an import that rebuilds the archive from scratch. */
export function clearArtifacts(db: Db): void {
  db.prepare("DELETE FROM artifacts").run();
}
