import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  pulsoEditionSchema,
  pulsoIndexSchema,
  type PulsoEdition,
  type PulsoIndex,
  type Slot,
} from "./schema.js";
import { modelCatalogSchema } from "../models/schema.js";
import type { ModelCatalog } from "../models/types.js";
import { editionFileName, editionPublicPath } from "./paths.js";

/** Public filename of the model catalogue artifact. */
export const CATALOG_FILE = "models.json";
/** The catalogue that opened the current week, kept in the kitchen only (never published). */
export const CATALOG_BASELINE_FILE = "models.baseline.json";

export interface EditionStore {
  dir: string;
  readEdition(calendarDate: string, slot: Slot): PulsoEdition | null;
  readLatest(): PulsoEdition | null;
  readIndex(): PulsoIndex;
  /**
   * Number the next edition will carry. Counted from the index rather than kept in a
   * counter file so there is one source of truth, and floored at the number of editions
   * already published so that the first numbered edition does not come out as #1 while
   * an archive of older ones sits below it.
   */
  nextEditionNumber(): number;
  writePublished(edition: PulsoEdition): void;
  /** Writes the model catalogue as its own artifact, shared by every edition. */
  writeCatalog(catalog: ModelCatalog): void;
  readCatalog(): ModelCatalog | null;
  readCatalogBaseline(): ModelCatalog | null;
  writeCatalogBaseline(catalog: ModelCatalog): void;
  /**
   * Replaces an already-published slot, keeping the previous artifact as a superseded
   * sibling. Returns the filename the old artifact was copied to, or null if there was
   * nothing to replace.
   */
  supersede(calendarDate: string, slot: Slot): string | null;
}

function readJson(filePath: string): unknown {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

/** Filesystem-safe stamp for a superseded artifact name. */
function stamp(capturedAt: string): string {
  return capturedAt.replace(/[:.]/g, "-");
}

function writeAtomically(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content);
    renameSync(temporary, filePath);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function createEditionStore(dir: string): EditionStore {
  function editionPath(calendarDate: string, slot: Slot): string {
    return path.join(dir, editionFileName(calendarDate, slot));
  }

  function readEdition(calendarDate: string, slot: Slot): PulsoEdition | null {
    const raw = readJson(editionPath(calendarDate, slot));
    if (raw == null) return null;
    return pulsoEditionSchema.parse(raw);
  }

  function readLatest(): PulsoEdition | null {
    const raw = readJson(path.join(dir, "latest.json"));
    if (raw == null) return null;
    return pulsoEditionSchema.parse(raw);
  }

  function readIndex(): PulsoIndex {
    const raw = readJson(path.join(dir, "index.json"));
    if (raw == null) {
      return { schemaVersion: 1, latestId: null, editions: [] };
    }
    return pulsoIndexSchema.parse(raw);
  }

  function nextEditionNumber(): number {
    const index = readIndex();
    const highest = index.editions.reduce((max, entry) => Math.max(max, entry.number ?? 0), 0);
    return Math.max(highest, index.editions.length) + 1;
  }

  function writeIndex(index: PulsoIndex): void {
    writeAtomically(path.join(dir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  }

  function supersede(calendarDate: string, slot: Slot): string | null {
    const filePath = editionPath(calendarDate, slot);
    if (!existsSync(filePath)) return null;
    const previous = pulsoEditionSchema.parse(readJson(filePath));
    const supersededName = `${slot}.superseded-${stamp(previous.capturedAt)}.json`;
    const supersededPath = path.join(dir, calendarDate, supersededName);
    // Preserve a snapshot without removing the canonical file. The new edition replaces it
    // atomically later, so a failed render or write leaves the published slot available.
    copyFileSync(filePath, supersededPath);
    return supersededName;
  }

  function writePublished(edition: PulsoEdition): void {
    const filePath = editionPath(edition.calendarDate, edition.slot);
    const json = `${JSON.stringify(edition, null, 2)}\n`;
    const index = readIndex();
    const entry = {
      id: edition.id,
      slot: edition.slot,
      calendarDate: edition.calendarDate,
      capturedAt: edition.capturedAt,
      number: edition.number,
      headline: edition.digest.headline,
      path: editionPublicPath(edition.calendarDate, edition.slot),
    };
    const editions = [entry, ...index.editions.filter((item) => item.id !== edition.id)];
    editions.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));

    // Each file replacement is atomic. Content lands first, then the archive index, and the
    // front-page pointer changes last.
    writeAtomically(filePath, json);
    writeIndex({
      schemaVersion: 1,
      latestId: edition.id,
      editions,
    });
    writeAtomically(path.join(dir, "latest.json"), json);
  }

  function writeCatalog(catalog: ModelCatalog): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, CATALOG_FILE), `${JSON.stringify(catalog, null, 2)}\n`);
  }

  function readCatalog(): ModelCatalog | null {
    const raw = readJson(path.join(dir, CATALOG_FILE));
    if (raw == null) return null;
    return modelCatalogSchema.parse(raw);
  }

  function readCatalogBaseline(): ModelCatalog | null {
    const raw = readJson(path.join(dir, CATALOG_BASELINE_FILE));
    if (raw == null) return null;
    return modelCatalogSchema.parse(raw);
  }

  function writeCatalogBaseline(catalog: ModelCatalog): void {
    // Without its own changes: a baseline is only ever compared against.
    const rest: ModelCatalog = { ...catalog };
    delete rest.changes;
    writeAtomically(path.join(dir, CATALOG_BASELINE_FILE), `${JSON.stringify(rest)}\n`);
  }

  return {
    dir,
    readEdition,
    readLatest,
    readIndex,
    nextEditionNumber,
    writePublished,
    writeCatalog,
    readCatalog,
    readCatalogBaseline,
    writeCatalogBaseline,
    supersede,
  };
}
