import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { priceFor } from "../edition/cost.js";
import type { PulsoJobInput } from "../edition/job.js";
import type { EditionJobResult } from "../edition/schema.js";
import type { DailyResult, KitchenMode } from "./daily.js";

/**
 * What one kitchen run spent and produced, written on every run — the ones that fail and the ones
 * that publish nothing included — and kept by the workflow as an artifact for `npm run health`.
 *
 * The artifact of a public repository can be downloaded by any signed-in GitHub user, so the
 * report carries numbers, step and model names and statuses only. No error text: messages can
 * quote URLs, responses or configuration, and the run's log already has them.
 */

const costEntrySchema = z.object({
  step: z.string(),
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  webSearchCalls: z.number(),
  usd: z.number(),
  /** False when the model is missing from MODEL_PRICES: `usd` then undercounts. */
  priced: z.boolean(),
});

const jobSchema = z.object({
  kind: z.enum(["edition", "catalogue"]),
  status: z.enum(["published", "unchanged", "partial", "error"]),
  editionId: z.string().nullable(),
  newItemCount: z.number(),
  skippedReason: z.enum(["no-delta", "slot-already-published", "locked"]).nullable(),
  costUsd: z.number(),
});

export const runReportSchema = z.object({
  schemaVersion: z.literal(1),
  startedAt: z.string(),
  finishedAt: z.string(),
  mode: z.enum(["daily", "catalogue"]),
  /** Whether the kitchen step itself succeeded; the rest of the workflow is in the run. */
  outcome: z.enum(["ok", "failed"]),
  /** Null when the run failed before deciding. */
  publish: z.boolean().nullable(),
  catalogue: z.enum(["captured", "failed", "skipped"]).nullable(),
  jobs: z.array(jobSchema),
  cost: z.object({
    totalUsd: z.number(),
    /** PULSO_MAX_EDITION_USD in effect: the ceiling a single edition may spend. */
    budgetUsd: z.number(),
    entries: z.array(costEntrySchema),
    unpricedModels: z.array(z.string()),
  }),
});

export type RunReport = z.infer<typeof runReportSchema>;
export type RunReportJob = RunReport["jobs"][number];

export interface RecordedJob {
  kind: RunReportJob["kind"];
  result: EditionJobResult;
}

type RunJob = (input: PulsoJobInput) => Promise<EditionJobResult>;

/** Wraps the job runner so every result is kept, even when the run fails later (an upload race). */
export function recordJobs(runJob: RunJob, jobs: RecordedJob[]): RunJob {
  return async (input) => {
    const result = await runJob(input);
    jobs.push({ kind: input.benchmarksOnly ? "catalogue" : "edition", result });
    return result;
  };
}

export function buildRunReport(input: {
  startedAt: Date;
  finishedAt: Date;
  mode: KitchenMode;
  jobs: RecordedJob[];
  /** Undefined when runDaily threw. */
  daily: DailyResult | undefined;
  budgetUsd: number;
}): RunReport {
  const entries = input.jobs.flatMap((job) =>
    (job.result.costBreakdown ?? []).map((row) => ({ ...row, priced: priceFor(row.model) !== undefined }))
  );
  const totalUsd = input.jobs.reduce((sum, job) => sum + job.result.costUsdApprox, 0);

  return {
    schemaVersion: 1,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    mode: input.mode,
    outcome: input.daily ? "ok" : "failed",
    publish: input.daily?.publish ?? null,
    catalogue: input.daily?.catalogue ?? null,
    jobs: input.jobs.map(({ kind, result }) => ({
      kind,
      status: result.status,
      editionId: result.editionId,
      newItemCount: result.newItemCount,
      skippedReason: result.skippedReason ?? null,
      costUsd: result.costUsdApprox,
    })),
    cost: {
      totalUsd: Number(totalUsd.toFixed(6)),
      budgetUsd: input.budgetUsd,
      entries,
      unpricedModels: [...new Set(entries.filter((entry) => !entry.priced).map((entry) => entry.model))],
    },
  };
}

export function writeRunReport(filePath: string, report: RunReport): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(runReportSchema.parse(report), null, 2)}\n`);
}
