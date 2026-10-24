import dotenv from "dotenv";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { editionEnvFromProcess, runPulsoJob } from "../edition/job.js";
import { repoRoot } from "../edition/paths.js";
import { maxEditionUsd } from "../edition/runEdition.js";
import { hasFlag } from "./args.js";
import { runDaily, type DailyResult, type KitchenMode } from "./daily.js";
import { buildRunReport, recordJobs, writeRunReport, type RecordedJob } from "./runReport.js";
import { stateTargetFromEnv } from "./storage.js";

/**
 * The scheduled kitchen run (see daily.ts). Usage:
 *
 *   npm run kitchen -- [--catalogue] [--force] [--init]
 *
 *   --catalogue  only the model catalogue, now (alias: --benchmarks)
 *   --force      rewrite today's edition even if it exists
 *   --init       allow starting from no kitchen at all (a fork's first run)
 *
 * Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (or KITCHEN_S3_ENDPOINT), plus
 * the model keys the edition uses. Writes `publish`, `catalogue` and `edition` to $GITHUB_OUTPUT,
 * and the run report (runReport.ts) to $PULSO_RUN_REPORT when set — also when the run fails.
 */

dotenv.config({ path: path.join(repoRoot(), "backend", ".env"), quiet: true });

function writeOutput(name: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function saveRunReport(input: {
  startedAt: Date;
  mode: KitchenMode;
  jobs: RecordedJob[];
  daily: DailyResult | undefined;
}): void {
  const file = process.env.PULSO_RUN_REPORT;
  if (!file) return;
  try {
    writeRunReport(
      file,
      buildRunReport({ ...input, finishedAt: new Date(), budgetUsd: maxEditionUsd(editionEnvFromProcess()) })
    );
  } catch (error) {
    // Bookkeeping: losing the report must never hide or replace the run's own outcome.
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`::warning::relatório da corrida não foi gravado: ${message}\n`);
  }
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const mode: KitchenMode = hasFlag("--catalogue") || hasFlag("--benchmarks") ? "catalogue" : "daily";
  const jobs: RecordedJob[] = [];
  let result: DailyResult | undefined;

  try {
    const target = stateTargetFromEnv();
    if (!target) throw new Error("armazenamento da cozinha não configurado (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)");

    result = await runDaily({
      target,
      workDir: process.env.KITCHEN_DIR ?? path.join(repoRoot(), ".kitchen"),
      mode,
      force: hasFlag("--force"),
      init: hasFlag("--init"),
      runJob: recordJobs(runPulsoJob, jobs),
      log: (line) => process.stdout.write(`${line}\n`),
    });
  } finally {
    saveRunReport({ startedAt, mode, jobs, daily: result });
  }

  writeOutput("publish", String(result.publish));
  writeOutput("catalogue", result.catalogue);
  writeOutput("edition", result.latestEditionId ?? "");
  for (const warning of result.warnings) {
    // Shown on the run's summary page without failing it: the kitchen itself was committed.
    process.stdout.write(`::warning::${warning}\n`);
  }
  process.stdout.write(`site: ${result.publish ? "publicar" : "nada novo para publicar"}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
