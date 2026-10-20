import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultFixturesDir } from "../edition/paths.js";
import { assignNumbers, prepareLegacyEditions, publicNumbers } from "./legacy.js";

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

describe("legacy numbering", () => {
  it("keeps the public number of an id the site already showed, and continues after the highest", () => {
    const known = publicNumbers({
      schemaVersion: 1,
      latestId: "b",
      editions: [
        { id: "a", slot: "manha", calendarDate: "2026-10-09", capturedAt: "1", number: 91, headline: "", path: "/" },
        { id: "old", slot: "tarde", calendarDate: "2026-09-01", capturedAt: "0", number: 95, headline: "", path: "/" },
        { id: "unnumbered", slot: "manha", calendarDate: "2026-08-01", capturedAt: "0", headline: "", path: "/" },
      ],
    });
    const numbers = assignNumbers(
      [
        { id: "c", capturedAt: "2026-10-12T10:00:00Z" },
        { id: "a", capturedAt: "2026-10-09T10:00:00Z" },
        { id: "b", capturedAt: "2026-10-11T10:00:00Z" },
      ],
      known
    );
    expect(Object.fromEntries(numbers)).toEqual({ a: 91, b: 96, c: 97 });
  });

  it("numbers from 1 when there is no public index", () => {
    const numbers = assignNumbers([{ id: "x", capturedAt: "2" }, { id: "w", capturedAt: "1" }], new Map());
    expect(Object.fromEntries(numbers)).toEqual({ w: 1, x: 2 });
  });

  it("refuses two editions with the same number", () => {
    expect(() =>
      assignNumbers([{ id: "a", capturedAt: "1" }, { id: "b", capturedAt: "2" }], new Map([["a", 3], ["b", 3]]))
    ).toThrow(/repetido/);
  });
});

describe("prepareLegacyEditions", () => {
  let source: string;
  let out: string;

  beforeEach(() => {
    const root = mkdtempSync(path.join(tmpdir(), "pulso-legacy-"));
    source = path.join(root, "old");
    out = path.join(root, "new");
    cpSync(defaultFixturesDir(), source, { recursive: true });

    // What the old kitchen also had: its own numbers, the three-slot era, superseded copies,
    // cover HTML, a status file.
    for (const [date, number] of [["2026-10-09", 113], ["2026-10-10", 114]] as const) {
      const file = path.join(source, date, "manha.json");
      const old = readJson(file);
      const benchmarks = { ...(old.benchmarks as object), attribution: ["Artificial Analysis", "LMArena"] };
      writeJson(file, { ...old, number, benchmarks });
      writeFileSync(path.join(source, date, "manha.cover-r1.html"), "<html></html>");
    }
    writeJson(path.join(source, "2026-10-10", "manha.superseded-2026-10-10T10-00-00-000Z.json"), {});
    writeJson(path.join(source, "2026-10-08", "tarde.json"), { id: "2026-10-08-tarde" });
    writeJson(path.join(source, "status.json"), {});
  });

  afterEach(() => {
    rmSync(path.dirname(source), { recursive: true, force: true });
  });

  it("moves the daily editions renumbered to their public numbers, with a fresh index", () => {
    const publicIndex = {
      schemaVersion: 1,
      latestId: "2026-10-09-manha",
      editions: [
        { id: "2026-10-09-manha", slot: "manha", calendarDate: "2026-10-09", capturedAt: "x", number: 91, headline: "h", path: "/pulso/2026-10-09/" },
      ],
    };
    const report = prepareLegacyEditions({ sourceDir: source, outDir: out, publicIndex });

    expect(report.editions.map((e) => [e.id, e.kitchenNumber, e.number])).toEqual([
      ["2026-10-09-manha", 113, 91],
      ["2026-10-10-manha", 114, 92],
    ]);
    expect(report).toMatchObject({ latestId: "2026-10-10-manha", catalog: true, missingCovers: [] });

    const moved = readJson(path.join(out, "2026-10-09", "manha.json"));
    expect(moved.number).toBe(91);
    // The card showed only Artificial Analysis's index; the old double credit is corrected.
    expect((moved.benchmarks as { attribution: string[] }).attribution).toEqual(["Artificial Analysis"]);
    expect(readJson(path.join(out, "latest.json"))).toMatchObject({ id: "2026-10-10-manha", number: 92 });
    const index = readJson(path.join(out, "index.json")) as { latestId: string; editions: Array<Record<string, unknown>> };
    expect(index.latestId).toBe("2026-10-10-manha");
    expect(index.editions.map((e) => [e.id, e.number, e.path])).toEqual([
      ["2026-10-10-manha", 92, "/2026-10-10/"],
      ["2026-10-09-manha", 91, "/2026-10-09/"],
    ]);

    // Everything else the old kitchen kept stays behind.
    expect(existsSync(path.join(out, "2026-10-10", "manha.cover-r1.svg"))).toBe(true);
    expect(existsSync(path.join(out, "models.json"))).toBe(true);
    expect(existsSync(path.join(out, "2026-10-10", "manha.cover-r1.html"))).toBe(false);
    expect(existsSync(path.join(out, "2026-10-10", "manha.superseded-2026-10-10T10-00-00-000Z.json"))).toBe(false);
    expect(existsSync(path.join(out, "2026-10-08"))).toBe(false);
    expect(existsSync(path.join(out, "status.json"))).toBe(false);
  });

  it("reports a cover the edition points at but the source lacks", () => {
    rmSync(path.join(source, "2026-10-09", "manha.cover-r1.svg"));
    const report = prepareLegacyEditions({ sourceDir: source, outDir: out, publicIndex: null });
    expect(report.missingCovers).toEqual(["2026-10-09/manha.cover-r1.svg"]);
  });

  it("refuses an edition that does not match the current contract", () => {
    const file = path.join(source, "2026-10-09", "manha.json");
    writeJson(file, { ...readJson(file), digest: null });
    expect(() => prepareLegacyEditions({ sourceDir: source, outDir: out, publicIndex: null })).toThrow();
  });
});
