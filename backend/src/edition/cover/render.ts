import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DAILY_SINCE } from "../paths.js";
import type { PulsoCover, PulsoEdition, Slot } from "../schema.js";
import { COVER } from "./brand.js";
import { coverSvg } from "./compose.js";

const SLOT_MARK: Record<Slot, string> = {
  manha: "MANHÃ",
  "meio-dia": "MEIO-DIA",
  tarde: "TARDE",
};

const MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

/** `PULSO · 09 OUT 2026` for the daily edition; older editions also named their slot. */
export function coverLabel(calendarDate: string, slot: Slot): string {
  const [year, month, day] = calendarDate.split("-").map(Number);
  const mon = MONTHS[(month ?? 1) - 1] ?? "";
  const label = `PULSO · ${String(day).padStart(2, "0")} ${mon} ${year}`;
  return slot === "manha" && calendarDate >= DAILY_SINCE ? label : `${label} · ${SLOT_MARK[slot]}`;
}

export function coverFileName(calendarDate: string, slot: Slot, revision: number): string {
  return path.join(calendarDate, `${slot}.cover-r${revision}.svg`);
}

export function coverPublicPath(calendarDate: string, slot: Slot, revision: number): string {
  return `/editions/${calendarDate}/${slot}.cover-r${revision}.svg`;
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

/**
 * Writes the edition's cover as SVG, the source the site build rasterizes into the social card.
 * The SVG itself is not published: no social platform renders it.
 */
export function writeEditionCover(edition: PulsoEdition, editionsDir: string): PulsoCover {
  const spec = {
    headline: edition.digest.headline,
    label: coverLabel(edition.calendarDate, edition.slot),
    slug: edition.id,
  };
  // A republish gets a new path. The old edition therefore keeps pointing at its old cover
  // until the new edition JSON is atomically replaced.
  const relative = coverFileName(edition.calendarDate, edition.slot, edition.revision);
  writeAtomically(path.join(editionsDir, relative), coverSvg(spec));

  return {
    path: coverPublicPath(edition.calendarDate, edition.slot, edition.revision),
    alt: `${spec.label}: ${edition.digest.headline}`,
    width: COVER.width,
    height: COVER.height,
  };
}
