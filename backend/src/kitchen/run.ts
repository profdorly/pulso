import dotenv from "dotenv";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { runPulsoJob } from "../edition/job.js";
import { repoRoot } from "../edition/paths.js";
import { hasFlag } from "./args.js";
import { runDaily } from "./daily.js";
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
 * the model keys the edition uses. Writes `publish`, `catalogue` and `edition` to $GITHUB_OUTPUT.
 */

dotenv.config({ path: path.join(repoRoot(), "backend", ".env"), quiet: true });

function writeOutput(name: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main(): Promise<void> {
  const target = stateTargetFromEnv();
  if (!target) throw new Error("armazenamento da cozinha não configurado (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)");

  const result = await runDaily({
    target,
    workDir: process.env.KITCHEN_DIR ?? path.join(repoRoot(), ".kitchen"),
    mode: hasFlag("--catalogue") || hasFlag("--benchmarks") ? "catalogue" : "daily",
    force: hasFlag("--force"),
    init: hasFlag("--init"),
    runJob: runPulsoJob,
    log: (line) => process.stdout.write(`${line}\n`),
  });

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
