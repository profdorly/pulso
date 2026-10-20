import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DAILY_SINCE, editionFileName, editionPublicPath } from "../edition/paths.js";
import { pulsoEditionSchema, pulsoIndexSchema, type PulsoIndex } from "../edition/schema.js";
import { CATALOG_FILE } from "../edition/store.js";

/**
 * One-time move of the AWS kitchen's editions into the new kitchen's layout.
 *
 * The old kitchen numbered every edition it ever wrote (three slots a day, then one); the public
 * site renumbered its own slice. From now on the kitchen number is the public number, so the
 * editions that move are renumbered from the live public index: the same id keeps the number
 * readers saw. Only the one-a-day journal moves (`DAILY_SINCE` on, the `manha` slot), with its
 * current cover and the model catalogue. Superseded copies, cover HTML and status files stay
 * behind.
 */

const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;
const SLOT = "manha";

export interface LegacyEdition {
  id: string;
  calendarDate: string;
  kitchenNumber: number | undefined;
  number: number;
  cover: string | null;
}

export interface LegacyImportReport {
  editions: LegacyEdition[];
  latestId: string | null;
  catalog: boolean;
  /** Covers an edition points at that were not found in the source directory. */
  missingCovers: string[];
}

interface RawEdition {
  id: string;
  calendarDate: string;
  capturedAt: string;
  number?: number;
  cover?: { path?: string } | null;
  digest: { headline: string };
  [key: string]: unknown;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Edition id → number already on the live public site. */
export function publicNumbers(index: PulsoIndex | null): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const entry of index?.editions ?? []) {
    if (typeof entry.number === "number" && entry.number > 0) numbers.set(entry.id, entry.number);
  }
  return numbers;
}

/**
 * Numbers for `editions`: an id the public site already numbered keeps it; the rest follow the
 * highest public number in the order they were captured.
 */
export function assignNumbers(
  editions: ReadonlyArray<{ id: string; capturedAt: string }>,
  known: ReadonlyMap<string, number>
): Map<string, number> {
  const assigned = new Map<string, number>();
  let next = Math.max(0, ...known.values()) + 1;
  const ordered = [...editions].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  for (const edition of ordered) {
    const number = known.get(edition.id);
    assigned.set(edition.id, number ?? next++);
  }
  const used = new Set<number>();
  for (const [id, number] of assigned) {
    if (used.has(number)) throw new Error(`número ${number} repetido (${id})`);
    used.add(number);
  }
  return assigned;
}

/** A cover's path relative to the editions directory, from what the edition recorded. */
function coverRelativePath(recorded: string | undefined): string | null {
  if (!recorded || /^https?:\/\//i.test(recorded)) return null;
  return recorded.replace(/^\/+/, "").replace(/^editions\//, "");
}

/**
 * The old kitchen credited "Artificial Analysis e LMArena" whenever both answered, even when the
 * model card showed only Artificial Analysis's index — which it always did. The moved editions
 * credit the source whose numbers are on screen.
 */
function creditOnScreen(edition: RawEdition): Pick<RawEdition, "benchmarks"> | Record<string, never> {
  const benchmarks = edition.benchmarks as { headline?: Array<{ metric?: string }>; attribution?: string[] } | undefined;
  const headline = benchmarks?.headline ?? [];
  const allIndex = headline.length > 0 && headline.every((row) => row.metric === "Índice de inteligência");
  if (!benchmarks || !allIndex || !benchmarks.attribution?.includes("LMArena")) return {};
  return { benchmarks: { ...benchmarks, attribution: ["Artificial Analysis"] } };
}

/**
 * Writes the new kitchen's editions directory to `outDir` from the old one in `sourceDir`.
 * `outDir` should be empty: nothing in it is removed, and the index is written from scratch.
 */
export function prepareLegacyEditions(input: {
  sourceDir: string;
  outDir: string;
  publicIndex: unknown;
}): LegacyImportReport {
  const publicIndex = input.publicIndex == null ? null : pulsoIndexSchema.parse(input.publicIndex);

  const editions: RawEdition[] = [];
  for (const name of readdirSync(input.sourceDir).sort()) {
    if (!DATE_DIR.test(name) || name < DAILY_SINCE) continue;
    const file = path.join(input.sourceDir, editionFileName(name, SLOT));
    if (!existsSync(file)) continue;
    const raw = readJson(file);
    // Validated against the current contract, but written back as read: nothing is dropped.
    const parsed = pulsoEditionSchema.parse(raw);
    if (parsed.calendarDate !== name || parsed.slot !== SLOT) throw new Error(`edição fora do lugar: ${file}`);
    editions.push(raw as RawEdition);
  }
  if (editions.length === 0) throw new Error(`nenhuma edição diária desde ${DAILY_SINCE} em ${input.sourceDir}`);

  const numbers = assignNumbers(editions, publicNumbers(publicIndex));
  const report: LegacyImportReport = { editions: [], latestId: null, catalog: false, missingCovers: [] };
  const entries: PulsoIndex["editions"] = [];
  const written = new Map<string, RawEdition>();

  for (const edition of editions) {
    const number = numbers.get(edition.id)!;
    const renumbered: RawEdition = { ...edition, number, ...creditOnScreen(edition) };
    writeJson(path.join(input.outDir, editionFileName(edition.calendarDate, SLOT)), renumbered);
    written.set(edition.id, renumbered);

    const cover = coverRelativePath(edition.cover?.path);
    if (cover) {
      const from = path.join(input.sourceDir, cover);
      if (existsSync(from)) {
        mkdirSync(path.dirname(path.join(input.outDir, cover)), { recursive: true });
        copyFileSync(from, path.join(input.outDir, cover));
      } else {
        report.missingCovers.push(cover);
      }
    }

    entries.push({
      id: edition.id,
      slot: SLOT,
      calendarDate: edition.calendarDate,
      capturedAt: edition.capturedAt,
      number,
      headline: edition.digest.headline,
      path: editionPublicPath(edition.calendarDate, SLOT),
    });
    report.editions.push({ id: edition.id, calendarDate: edition.calendarDate, kitchenNumber: edition.number, number, cover });
  }

  entries.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  const latestId = entries[0].id;
  const index: PulsoIndex = { schemaVersion: 1, latestId, editions: entries };
  writeJson(path.join(input.outDir, "index.json"), pulsoIndexSchema.parse(index));
  writeJson(path.join(input.outDir, "latest.json"), written.get(latestId));
  report.latestId = latestId;

  const catalog = path.join(input.sourceDir, CATALOG_FILE);
  if (existsSync(catalog)) {
    copyFileSync(catalog, path.join(input.outDir, CATALOG_FILE));
    report.catalog = true;
  }
  report.editions.sort((a, b) => a.number - b.number);
  return report;
}
