import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

/** Shared CLI plumbing for the pilot; kept apart so the entry point has no import cycle. */

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../..");
loadEnv({ path: path.join(repoRoot, "backend/.env"), quiet: true });
loadEnv({ path: path.join(repoRoot, ".env.local"), quiet: true });

export function arg(flag: string, fallback?: string): string {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`faltou ${flag}`);
}

export function pilotDir(weekId: string): string {
  const dir = path.join(repoRoot, ".tmp/weekly-audio-pilot", weekId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
