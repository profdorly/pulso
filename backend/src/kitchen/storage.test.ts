import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupState,
  downloadPrefix,
  downloadState,
  headState,
  pruneBackups,
  StateConflictError,
  stateTargetFromEnv,
  uploadDir,
  uploadState,
  type StateTarget,
} from "./storage.js";
import { FakeBucket } from "./fakeBucket.js";

describe("kitchen storage", () => {
  let dir: string;
  let bucket: FakeBucket;
  let target: StateTarget;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "pulso-storage-"));
    bucket = new FakeBucket();
    target = bucket.target();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("is not configured without credentials, and builds the R2 endpoint from the account", async () => {
    expect(stateTargetFromEnv({})).toBeNull();
    expect(stateTargetFromEnv({ R2_ACCOUNT_ID: "abc", R2_ACCESS_KEY_ID: "id" })).toBeNull();

    const configured = stateTargetFromEnv({ R2_ACCOUNT_ID: "abc", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret" });
    expect(configured).toMatchObject({ bucket: "pulso-cozinha", key: "news.db", backupPrefix: "backups/" });
    const endpoint = await (configured!.client as unknown as { config: { endpoint: () => Promise<{ hostname: string }> } }).config.endpoint();
    expect(endpoint.hostname).toBe("abc.r2.cloudflarestorage.com");
  });

  it("treats a missing kitchen as a new one, and creates it only if it is still missing", async () => {
    const local = path.join(dir, "k", "news.db");
    const revision = await downloadState(target, local);
    expect(revision).toEqual({ exists: false });

    writeFileSync(local, "first");
    await uploadState(target, local, revision);
    expect(bucket.puts.at(-1)).toMatchObject({ IfNoneMatch: "*" });
    expect(bucket.objects.get("news.db")?.body.toString()).toBe("first");

    // A second "new" kitchen must not overwrite the one that now exists.
    writeFileSync(local, "second");
    await expect(uploadState(target, local, { exists: false })).rejects.toBeInstanceOf(StateConflictError);
    expect(bucket.objects.get("news.db")?.body.toString()).toBe("first");
  });

  it("uploads over the version it downloaded, and refuses when that version moved", async () => {
    bucket.put("news.db", "v1");
    const local = path.join(dir, "news.db");
    const revision = await downloadState(target, local);
    expect(readFileSync(local, "utf8")).toBe("v1");

    // Something else wrote in between.
    bucket.put("news.db", "elsewhere");
    writeFileSync(local, "mine");
    await expect(uploadState(target, local, revision)).rejects.toBeInstanceOf(StateConflictError);
    expect(bucket.objects.get("news.db")?.body.toString()).toBe("elsewhere");

    const fresh = await headState(target);
    await uploadState(target, local, fresh);
    expect(bucket.puts.at(-1)).toMatchObject({ IfMatch: fresh.etag });
    expect(bucket.objects.get("news.db")?.body.toString()).toBe("mine");
  });

  it("takes a 412 on a retried PUT as success when what is stored is the file being uploaded", async () => {
    bucket.put("news.db", "v1");
    const local = path.join(dir, "news.db");
    const revision = await downloadState(target, local);
    writeFileSync(local, "mine");
    // The first attempt landed, its response was lost, and the SDK retried with the old If-Match.
    bucket.put("news.db", "mine");
    await expect(uploadState(target, local, revision)).resolves.toBe(bucket.objects.get("news.db")?.etag);
  });

  it("does not take a missing bucket for an empty kitchen", async () => {
    const missingBucket: StateTarget = {
      ...target,
      client: {
        send: () => Promise.reject(Object.assign(new Error("NoSuchBucket"), { name: "NoSuchBucket", $metadata: { httpStatusCode: 404 } })),
      },
    };
    await expect(downloadState(missingBucket, path.join(dir, "x.db"))).rejects.toThrow(/NoSuchBucket/);
  });

  it("refuses to overwrite a kitchen whose version it does not know", async () => {
    const local = path.join(dir, "news.db");
    writeFileSync(local, "x");
    await expect(uploadState(target, local, { exists: true })).rejects.toThrow(/versão da cozinha desconhecida/);
  });

  it("keeps one dated copy a day and prunes those older than the window", async () => {
    const local = path.join(dir, "news.db");
    writeFileSync(local, "today");
    for (const day of ["2026-09-01", "2026-09-18", "2026-09-19", "2026-10-18"]) bucket.put(`backups/news-${day}.db`, day);
    bucket.put("backups/notes.txt", "not a copy");

    const now = new Date("2026-10-19T10:30:00Z");
    expect(await backupState(target, local, now)).toBe("backups/news-2026-10-19.db");
    const removed = await pruneBackups(target, now, 30);

    expect(removed).toEqual(["backups/news-2026-09-01.db", "backups/news-2026-09-18.db"]);
    expect([...bucket.objects.keys()].filter((key) => key.startsWith("backups/")).sort()).toEqual([
      "backups/news-2026-09-19.db",
      "backups/news-2026-10-18.db",
      "backups/news-2026-10-19.db",
      "backups/notes.txt",
    ]);
  });

  it("mirrors a prefix both ways and never writes outside the target directory", async () => {
    const source = path.join(dir, "weekly-src");
    mkdirSync(path.join(source, "2026-W40"), { recursive: true });
    writeFileSync(path.join(source, "index.json"), "{}");
    writeFileSync(path.join(source, "2026-W40", "episode.json"), "{\"a\":1}");
    writeFileSync(path.join(source, "2026-W40", "episode.mp3"), "mp3");

    expect(await uploadDir(target, source, "weekly/")).toBe(3);
    bucket.put("weekly/../../escape.txt", "no");

    const out = path.join(dir, "out", "weekly");
    expect(await downloadPrefix(target, "weekly/", out)).toBe(3);
    expect(readFileSync(path.join(out, "2026-W40", "episode.json"), "utf8")).toBe("{\"a\":1}");
    expect(readFileSync(path.join(out, "index.json"), "utf8")).toBe("{}");
  });
});
