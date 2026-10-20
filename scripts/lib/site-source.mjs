/**
 * Where the site build reads its content from, shared by build-site, rasterize-covers, prerender
 * and the checks that run after them.
 *
 * The kitchen's editions directory is the input; nothing from it is copied into the site as-is.
 * It comes from `--editions <dir>`, or `PULSO_EDITIONS_DIR`, or `data/editions` (a local run or
 * the workflow's download), or the tracked samples in `fixtures/editions`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DAILY_SINCE } from "./edition-paths.mjs";

export function argValue(flag, fallback, argv = process.argv) {
  const prefix = `${flag}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(flag);
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return fallback;
}

function hasIndex(dir) {
  return existsSync(path.join(dir, "index.json"));
}

export function resolveEditionsDir(repoRoot, argv = process.argv) {
  const explicit = argValue("--editions", process.env.PULSO_EDITIONS_DIR ?? null, argv);
  if (explicit) {
    const dir = path.resolve(repoRoot, explicit);
    if (!hasIndex(dir)) throw new Error(`${explicit} has no index.json`);
    return { dir, source: path.relative(repoRoot, dir) || dir };
  }
  for (const relative of ["data/editions", "fixtures/editions"]) {
    const dir = path.join(repoRoot, relative);
    if (hasIndex(dir)) return { dir, source: relative };
  }
  throw new Error("no editions found in data/editions or fixtures/editions");
}

/**
 * The weekly audio's published files (`<dir>/index.json`, one folder per episode), or null.
 * `--weekly <dir>` and `PULSO_WEEKLY_DIR` name a pilot output whose `weekly/` folder is used;
 * otherwise a `weekly/` folder inside the editions directory, if it has an index.
 */
export function resolveWeeklyDir(repoRoot, editionsDir, argv = process.argv) {
  const explicit = argValue("--weekly", process.env.PULSO_WEEKLY_DIR ?? null, argv);
  if (explicit) {
    const dir = path.resolve(repoRoot, explicit, "weekly");
    if (!existsSync(path.join(dir, "index.json"))) throw new Error(`--weekly ${explicit} has no weekly/index.json`);
    return dir;
  }
  const inside = path.join(editionsDir, "weekly");
  return existsSync(path.join(inside, "index.json")) ? inside : null;
}

/** One edition a day, at its date. Anything else is the old format and is not published. */
export function isDailyEntry(entry) {
  return entry.slot === "manha" && entry.calendarDate >= DAILY_SINCE;
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** The published editions: the index filtered to daily editions whose file exists, newest first. */
export function readPublicEditions(editionsDir) {
  const index = readJson(path.join(editionsDir, "index.json"));
  const entries = index.editions.filter(
    (entry) => isDailyEntry(entry) && existsSync(path.join(editionsDir, entry.calendarDate, `${entry.slot}.json`))
  );
  const editions = entries.map((entry) => readJson(path.join(editionsDir, entry.calendarDate, `${entry.slot}.json`)));
  return {
    index: { ...index, latestId: entries[0]?.id ?? null, editions: entries },
    editions,
    latest: editions[0] ?? null,
  };
}

/** Path of a cover SVG relative to the editions directory, from what the edition recorded. */
export function coverRelativePath(edition) {
  const recorded = edition.cover?.path;
  if (!recorded || /^https?:\/\//i.test(recorded)) return null;
  return recorded.replace(/^\/+/, "").replace(/^editions\//, "");
}
