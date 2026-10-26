import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PulsoJobInput } from "../edition/job.js";
import type { EditionJobResult } from "../edition/schema.js";
import { buildRunReport, recordJobs, runReportSchema, writeRunReport, type RecordedJob } from "./runReport.js";

const startedAt = new Date("2026-10-24T10:32:05.000Z");
const finishedAt = new Date("2026-10-24T10:41:40.000Z");

function edition(overrides: Partial<EditionJobResult> = {}): EditionJobResult {
  return {
    status: "published",
    editionId: "2026-10-24-manha",
    newItemCount: 9,
    costUsdApprox: 0.31,
    costBreakdown: [
      { step: "worker", model: "gpt-6-luna", inputTokens: 40_000, outputTokens: 6_000, webSearchCalls: 0, usd: 0.007 },
      { step: "editorial", model: "gpt-6.1-sol", inputTokens: 90_000, outputTokens: 12_000, webSearchCalls: 0, usd: 0.3 },
      { step: "audit", model: "modelo-novo", inputTokens: 1_000, outputTokens: 100, webSearchCalls: 0, usd: 0.003 },
    ],
    ...overrides,
  };
}

const daily = { uploaded: true, publish: true, catalogue: "skipped" as const, latestEditionId: "2026-10-24-manha", warnings: [] };

describe("buildRunReport", () => {
  it("keeps tokens and dollars per step, and flags models without a price", () => {
    const report = buildRunReport({
      startedAt,
      finishedAt,
      mode: "daily",
      jobs: [{ kind: "edition", result: edition() }],
      daily,
      budgetUsd: 4,
    });

    expect(runReportSchema.parse(report)).toEqual(report);
    expect(report.outcome).toBe("ok");
    expect(report.cost.totalUsd).toBe(0.31);
    expect(report.cost.entries.map((entry) => [entry.step, entry.priced])).toEqual([
      ["worker", true],
      ["editorial", true],
      ["audit", false],
    ]);
    expect(report.cost.unpricedModels).toEqual(["modelo-novo"]);
    expect(report.jobs).toEqual([
      { kind: "edition", status: "published", editionId: "2026-10-24-manha", newItemCount: 9, skippedReason: null, costUsd: 0.31 },
    ]);
  });

  it("reports a failed run with what its jobs had already spent", () => {
    const report = buildRunReport({
      startedAt,
      finishedAt,
      mode: "daily",
      jobs: [{ kind: "edition", result: edition() }],
      daily: undefined,
      budgetUsd: 4,
    });

    expect(report.outcome).toBe("failed");
    expect(report.publish).toBeNull();
    expect(report.catalogue).toBeNull();
    expect(report.cost.totalUsd).toBe(0.31);
  });

  it("reports a run that failed before any job as zero cost, not as missing", () => {
    const report = buildRunReport({ startedAt, finishedAt, mode: "catalogue", jobs: [], daily: undefined, budgetUsd: 4 });
    expect(report.jobs).toEqual([]);
    expect(report.cost).toEqual({ totalUsd: 0, budgetUsd: 4, entries: [], unpricedModels: [] });
  });

  it("never carries error text", () => {
    const report = buildRunReport({
      startedAt,
      finishedAt,
      mode: "daily",
      jobs: [{ kind: "edition", result: edition({ status: "error", error: "segredo-sentinela https://interno" }) }],
      daily: undefined,
      budgetUsd: 4,
    });
    expect(JSON.stringify(report)).not.toContain("segredo-sentinela");
  });

  it("rejects a report from an unknown schema version", () => {
    const report = buildRunReport({ startedAt, finishedAt, mode: "daily", jobs: [], daily, budgetUsd: 4 });
    expect(runReportSchema.safeParse({ ...report, schemaVersion: 2 }).success).toBe(false);
  });
});

describe("quality", () => {
  it("carries the edition's numbers, and reads a report written before they existed", () => {
    const quality = { kind: "regular" as const, items: 9, withSummary: 8, feedsFailed: 1, stepNotes: ["pulso-audit"], audited: 8, auditRemoved: 1, gateDropped: 0, headlineFellBack: false };
    const report = buildRunReport({ startedAt, finishedAt, mode: "daily", jobs: [{ kind: "edition", result: edition({ quality }) }], daily, budgetUsd: 4 });
    expect(report.jobs[0].quality).toEqual(quality);

    const before = buildRunReport({ startedAt, finishedAt, mode: "daily", jobs: [{ kind: "edition", result: edition() }], daily, budgetUsd: 4 });
    expect(before.jobs[0]).not.toHaveProperty("quality");
    expect(runReportSchema.safeParse(before).success).toBe(true);
  });
});

describe("recordJobs", () => {
  it("keeps every result with its kind", async () => {
    const jobs: RecordedJob[] = [];
    const run = recordJobs((input: PulsoJobInput) => Promise.resolve(edition({ newItemCount: input.benchmarksOnly ? 40 : 9 })), jobs);

    await run({ slot: "manha", benchmarksOnly: true } as PulsoJobInput);
    await run({ slot: "manha", benchmarksOnly: false } as PulsoJobInput);

    expect(jobs.map((job) => [job.kind, job.result.newItemCount])).toEqual([
      ["catalogue", 40],
      ["edition", 9],
    ]);
  });
});

describe("writeRunReport", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("writes a report that parses back, creating the folder", () => {
    dir = mkdtempSync(path.join(tmpdir(), "pulso-run-report-"));
    const file = path.join(dir, "nova", "run-report-1.json");
    const report = buildRunReport({ startedAt, finishedAt, mode: "daily", jobs: [{ kind: "edition", result: edition() }], daily, budgetUsd: 4 });

    writeRunReport(file, report);

    expect(runReportSchema.parse(JSON.parse(readFileSync(file, "utf8")))).toEqual(report);
  });
});
