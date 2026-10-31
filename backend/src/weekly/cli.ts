import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

/** Shared CLI plumbing for the weekly audio; kept apart so the entry points have no import cycle. */

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

export function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

/**
 * Where each week's working files live: script, approval, chunks, the assembled episode.
 *
 * Outside git (`.tmp/` is ignored) because the MP3 chunks are heavy and the script is not
 * public until the episode is. `PULSO_SEMANA_DIR` points elsewhere — a scratch copy for a dry
 * run, for instance — and is resolved from the repository root.
 */
export function workRoot(): string {
  return path.resolve(repoRoot, process.env.PULSO_SEMANA_DIR ?? ".tmp/weekly-audio-pilot");
}

export function pilotDir(weekId: string): string {
  const dir = path.join(workRoot(), weekId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The approval and the audio are tied to this exact file: any edit after either one shows. */
export function fileSha256(file: string): string | null {
  return existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Today's date where the Pulso is published, whatever the machine's time zone. */
export function todayInBrazil(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

/**
 * The Monday that opens the last complete week (Monday to Sunday, in Brasília).
 *
 * Run on a Monday, that is the week that ended the day before — the one the episode covers.
 */
export function lastClosedWeekStart(now = new Date()): string {
  const today = todayInBrazil(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
  return addDays(today, -(weekday - 1) - 7);
}

/** `--inicio AAAA-MM-DD` (a Monday), or the last closed week. */
export function weekStartArg(): string {
  const value = process.argv.includes("--inicio")
    ? arg("--inicio")
    : process.argv.includes("--week-start")
      ? arg("--week-start")
      : lastClosedWeekStart();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00Z`))) {
    throw new Error(`--inicio ${value}: use AAAA-MM-DD`);
  }
  if (new Date(`${value}T12:00:00Z`).getUTCDay() !== 1) {
    throw new Error(`--inicio ${value} não é uma segunda-feira; a semana do episódio vai de segunda a domingo`);
  }
  return value;
}
