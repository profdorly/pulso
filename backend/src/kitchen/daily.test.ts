import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeDb } from "../db/index.js";
import type { PulsoJobInput } from "../edition/job.js";
import type { EditionJobResult } from "../edition/schema.js";
import { captureArtifacts } from "./artifacts.js";
import { MissingKitchenError, runDaily } from "./daily.js";
import { FakeBucket } from "./fakeBucket.js";
import { StateConflictError } from "./storage.js";

// A Wednesday and a Monday, at the scheduled 07:30 in Brasília.
const WEDNESDAY = new Date("2026-10-21T10:30:00Z");
const MONDAY = new Date("2026-10-26T10:30:00Z");

function writeJson(dir: string, relative: string, value: unknown): void {
  mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
  writeFileSync(path.join(dir, relative), JSON.stringify(value));
}

function indexWith(...dates: string[]) {
  return {
    schemaVersion: 1,
    latestId: `${dates[0]}-manha`,
    editions: dates.map((date) => ({
      id: `${date}-manha`,
      slot: "manha",
      calendarDate: date,
      capturedAt: `${date}T10:31:00.000Z`,
      headline: "h",
      path: `/${date}/`,
    })),
  };
}

const catalogAt = (capturedAt: string) => ({ schemaVersion: 1, capturedAt, sources: [], sections: [], coverage: [] });

/** A kitchen file holding an index and a catalogue, as the bucket would. */
function kitchenFile(dir: string, catalogCapturedAt: string): Buffer {
  const editions = path.join(dir, "seed-editions");
  writeJson(editions, "index.json", indexWith("2026-10-20"));
  writeJson(editions, "models.json", catalogAt(catalogCapturedAt));
  const file = path.join(dir, "seed.db");
  const { db } = initializeDb({ DATABASE_PATH: file });
  captureArtifacts(db, editions);
  db.close();
  return readFileSync(file);
}

type Job = (input: PulsoJobInput) => Promise<EditionJobResult>;

function fakeJob(calls: string[], options: { edition?: Partial<EditionJobResult>; catalogueAt?: string } = {}): Job {
  return (input) => {
    if (input.benchmarksOnly) {
      calls.push("catalogue");
      if (options.catalogueAt) writeJson(input.editionsDir!, "models.json", catalogAt(options.catalogueAt));
      return Promise.resolve({ status: "published", editionId: null, newItemCount: 3, costUsdApprox: 0 });
    }
    calls.push("edition");
    const result: EditionJobResult = { status: "published", editionId: "2026-10-21-manha", newItemCount: 12, costUsdApprox: 0.3, ...options.edition };
    if (result.status === "published") writeJson(input.editionsDir!, "index.json", indexWith("2026-10-21", "2026-10-20"));
    return Promise.resolve(result);
  };
}

describe("runDaily", () => {
  let dir: string;
  let bucket: FakeBucket;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "pulso-daily-"));
    bucket = new FakeBucket();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (job: Job, extra: Partial<Parameters<typeof runDaily>[0]> = {}) =>
    runDaily({ target: bucket.target(), workDir: path.join(dir, "work"), mode: "daily", now: WEDNESDAY, runJob: job, ...extra });

  it("refuses to start from nothing unless told to, so a lost kitchen cannot restart the journal at #1", async () => {
    const calls: string[] = [];
    await expect(run(fakeJob(calls))).rejects.toBeInstanceOf(MissingKitchenError);
    expect(calls).toEqual([]);
    expect(bucket.puts).toEqual([]);

    const result = await run(fakeJob(calls), { init: true });
    expect(result).toMatchObject({ uploaded: true, publish: true, latestEditionId: "2026-10-21-manha" });
    expect(bucket.puts[0]).toMatchObject({ Key: "news.db", IfNoneMatch: "*" });
  });

  it("runs the edition, uploads over the version it downloaded, then keeps a dated copy", async () => {
    const etag = bucket.put("news.db", kitchenFile(dir, "2026-10-19T11:00:00.000Z"));
    const calls: string[] = [];
    const result = await run(fakeJob(calls));

    // Not Monday, and the catalogue is two days old: only the edition.
    expect(calls).toEqual(["edition"]);
    expect(result).toMatchObject({ uploaded: true, publish: true, catalogue: "skipped", latestEditionId: "2026-10-21-manha", warnings: [] });
    expect(bucket.puts.map((put) => [put.Key, put.IfMatch])).toEqual([
      ["news.db", etag],
      ["backups/news-2026-10-21T103000Z.db", undefined],
    ]);

    // What was uploaded is a sound kitchen holding the new index, with no WAL left behind.
    const uploaded = path.join(dir, "uploaded.db");
    writeFileSync(uploaded, bucket.objects.get("news.db")!.body);
    const db = new Database(uploaded, { readonly: true });
    const index = db.prepare("SELECT body FROM artifacts WHERE path = 'index.json'").get() as { body: Buffer };
    expect((JSON.parse(index.body.toString()) as { latestId: string }).latestId).toBe("2026-10-21-manha");
    db.close();
  });

  it("captures the catalogue before the edition on Monday, and only once", async () => {
    bucket.put("news.db", kitchenFile(dir, "2026-10-19T11:00:00.000Z"));
    const calls: string[] = [];
    const first = await run(fakeJob(calls, { catalogueAt: "2026-10-26T10:31:00.000Z" }), { now: MONDAY });
    expect(calls).toEqual(["catalogue", "edition"]);
    expect(first.catalogue).toBe("captured");

    // The 09:40 catch-up: the catalogue is fresh, the edition exists.
    calls.length = 0;
    const second = await run(
      fakeJob(calls, { edition: { status: "unchanged", newItemCount: 0, skippedReason: "slot-already-published" } }),
      { now: new Date("2026-10-26T12:40:00Z") }
    );
    expect(calls).toEqual(["edition"]);
    expect(second).toMatchObject({ uploaded: false, publish: false, catalogue: "skipped" });
  });

  it("retries a Monday catalogue that failed on the next day", async () => {
    bucket.put("news.db", kitchenFile(dir, "2026-10-19T11:00:00.000Z"));
    const calls: string[] = [];
    const tuesday = new Date("2026-10-27T10:30:00Z");
    // The job ran but wrote no catalogue (the source was down).
    const result = await run(fakeJob(calls), { now: tuesday });
    expect(calls).toEqual(["catalogue", "edition"]);
    expect(result.catalogue).toBe("failed");
  });

  it("uploads nothing when the edition fails", async () => {
    bucket.put("news.db", kitchenFile(dir, "2026-10-19T11:00:00.000Z"));
    await expect(run(fakeJob([], { edition: { status: "error", error: "boom" } }))).rejects.toThrow(/boom/);
    expect(bucket.puts).toEqual([]);
  });

  it("keeps the run once the upload has committed, even if the dated copy fails", async () => {
    bucket.put("news.db", kitchenFile(dir, "2026-10-19T11:00:00.000Z"));
    bucket.failPut.add("backups/news-2026-10-21T103000Z.db");
    const result = await run(fakeJob([]));
    expect(result).toMatchObject({ uploaded: true, publish: true });
    expect(result.warnings).toEqual([expect.stringMatching(/cópia diária falhou/)]);
  });

  it("fails instead of overwriting a kitchen that changed while it ran", async () => {
    bucket.put("news.db", kitchenFile(dir, "2026-10-19T11:00:00.000Z"));
    const job: Job = async (input) => {
      const result = await fakeJob([])(input);
      bucket.put("news.db", "another run's kitchen");
      return result;
    };
    await expect(run(job)).rejects.toBeInstanceOf(StateConflictError);
    expect(bucket.objects.get("news.db")?.body.toString()).toBe("another run's kitchen");
  });
});
