import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeDb } from "../db/index.js";
import { runPulsoJob } from "./job.js";
import { defaultEditionsDir, defaultLockPath, repoRoot } from "./paths.js";
import { inferSlot, isSlot } from "./timezone.js";
import type { Slot } from "./schema.js";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../../.env") });

function argValue(flag: string): string | undefined {
  const prefix = `${flag}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const index = process.argv.indexOf(flag);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag) || process.argv.some((arg) => arg.startsWith(`${flag}=`));
}

async function main(): Promise<void> {
  const slotArg = argValue("--slot");
  const slot: Slot = slotArg && isSlot(slotArg) ? slotArg : inferSlot();
  const databasePath = process.env.DATABASE_PATH ?? path.join(repoRoot(), "data", "news.db");
  const { db, repositories } = initializeDb({ DATABASE_PATH: databasePath });

  try {
    const result = await runPulsoJob({
      slot,
      force: hasFlag("--force"),
      benchmarksOnly: hasFlag("--benchmarks"),
      editionsDir: process.env.EDITIONS_DIR ?? defaultEditionsDir(),
      lockPath: process.env.EDITION_LOCK_PATH ?? defaultLockPath(),
      repositories,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status === "error") {
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
