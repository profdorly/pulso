import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { wrapHeadline } from "./brand.js";
import { coverSvg } from "./compose.js";
import { coverLabel, writeEditionCover } from "./render.js";
import type { PulsoEdition } from "../schema.js";

describe("cover", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it("wraps a long headline without dropping the tail", () => {
    const lines = wrapHeadline("Tecnoblog e MIT TR Brasil cobrem o recorte local da disputa", 22, 4);
    expect(lines.join(" ")).toContain("disputa");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(4);
  });

  it("names the day alone for the daily edition, and the slot for anything else", () => {
    expect(coverLabel("2026-10-09", "manha")).toBe("PULSO · 09 OUT 2026");
    expect(coverLabel("2026-10-09", "tarde")).toBe("PULSO · 09 OUT 2026 · TARDE");
    expect(coverLabel("2026-08-14", "tarde")).toBe("PULSO · 14 AGO 2026 · TARDE");
  });

  it("writes an SVG cover with headline and wordmark", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pulso-cover-"));
    dirs.push(dir);
    const edition = {
      id: "2026-08-14-tarde",
      schemaVersion: 1,
      slot: "tarde",
      calendarDate: "2026-08-14",
      timezone: "America/Sao_Paulo",
      capturedAt: "2026-08-14T21:32:00.000Z",
      status: "ok",
      predecessorId: null,
      revision: 1,
      supersedesCapturedAt: null,
      kind: "regular",
      gate: {
        checked: 0,
        bulletsDropped: 0,
        blurbsDropped: 0,
        headlineFellBack: false,
        unsupportedSamples: [],
      },
      digest: {
        headline: "IA entra na rotina",
        lede: "Lede.",
        bullets: [],
      },
      items: [],
      sourceFailures: [],
      benchmarks: {
        capturedAt: "2026-08-14T21:32:00.000Z",
        previousCapturedAt: null,
        headline: [],
        attribution: [],
        rows: [],
      },
      models: { discovery: "x", editorial: "x", worker: "x" },
      costUsdApprox: 0,
      costBreakdown: [],
    } as PulsoEdition;

    const cover = writeEditionCover(edition, dir);
    const svg = readFileSync(path.join(dir, "2026-08-14", "tarde.cover-r1.svg"), "utf8");
    expect(cover.path).toBe("/editions/2026-08-14/tarde.cover-r1.svg");
    expect(svg).toContain("IA entra na rotina");
    expect(svg).toContain("PULSO");
    expect(svg).toContain("DORLY.COM.BR");
    // Only the SVG: the site build rasterizes it, and an HTML twin was never read by anything.
    expect(existsSync(path.join(dir, "2026-08-14", "tarde.cover-r1.html"))).toBe(false);
    expect(coverSvg({ headline: "IA entra na rotina", label: "PULSO · TARDE", slug: "x" })).toContain(
      "IA entra na rotina"
    );
    expect(coverSvg({ headline: "IA entra na rotina", label: "PULSO · TARDE", slug: "x" })).toContain(
      "'Playfair Display'"
    );
    expect(coverSvg({ headline: "IA entra na rotina", label: "PULSO · TARDE", slug: "x" })).toContain(
      "'IBM Plex Mono'"
    );
  });
});
