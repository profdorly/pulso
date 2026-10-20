import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PulsoEdition, Slot } from "./schema.js";
import { createEditionStore } from "./store.js";

function edition(overrides: Partial<PulsoEdition> = {}): PulsoEdition {
  const calendarDate = overrides.calendarDate ?? "2026-08-14";
  const slot: Slot = overrides.slot ?? "manha";
  return {
    id: `${calendarDate}-${slot}`,
    schemaVersion: 1,
    slot,
    calendarDate,
    timezone: "America/Sao_Paulo",
    capturedAt: `${calendarDate}T10:00:00.000Z`,
    status: "ok",
    kind: "regular",
    predecessorId: null,
    revision: 1,
    supersedesCapturedAt: null,
    digest: { headline: "Uma manchete", lede: "Um lede.", bullets: [] },
    items: [],
    sourceFailures: [],
    benchmarks: {
      capturedAt: `${calendarDate}T09:00:00.000Z`,
      previousCapturedAt: null,
      headline: [],
      attribution: [],
      rows: [],
    },
    models: { discovery: "m", editorial: "m", worker: "m" },
    costUsdApprox: 0,
    costBreakdown: [],
    gate: {
      checked: 0,
      bulletsDropped: 0,
      blurbsDropped: 0,
      headlineFellBack: false,
      unsupportedSamples: [],
    },
    ...overrides,
  };
}

describe("edition numbering", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "pulso-store-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts at 1 on an empty archive", () => {
    expect(createEditionStore(dir).nextEditionNumber()).toBe(1);
  });

  it("counts unnumbered editions so the first numbered one does not land behind the archive", () => {
    const store = createEditionStore(dir);
    // Three editions from before numbering existed: parsed without a number, on purpose.
    for (const date of ["2026-08-11", "2026-08-12", "2026-08-13"]) {
      store.writePublished(edition({ calendarDate: date, number: undefined }));
    }

    // Not 1: publishing #1 on top of three older editions would read as a reset.
    expect(store.nextEditionNumber()).toBe(4);
  });

  it("keeps the number and only moves the revision when a slot is republished", () => {
    const store = createEditionStore(dir);
    store.writePublished(edition({ number: 7 }));

    // What runEdition does on a forced republish: reuse the slot's number, bump revision.
    const existing = store.readEdition("2026-08-14", "manha");
    expect(existing?.number).toBe(7);
    store.writePublished(
      edition({
        number: existing?.number,
        revision: 2,
        capturedAt: "2026-08-14T12:00:00.000Z",
        digest: { headline: "Manchete corrigida", lede: "Outro lede.", bullets: [] },
      })
    );

    const republished = store.readEdition("2026-08-14", "manha");
    expect(republished?.number).toBe(7);
    expect(republished?.revision).toBe(2);
    // One entry, still numbered 7: a republish must not grow the archive.
    const index = store.readIndex();
    expect(index.editions).toHaveLength(1);
    expect(index.editions[0].number).toBe(7);
    // And the next new edition follows the number that exists, not the entry count.
    expect(store.nextEditionNumber()).toBe(8);
  });

  it("mirrors the number into the index so the archive can label entries", () => {
    const store = createEditionStore(dir);
    store.writePublished(edition({ number: 3 }));

    const raw = JSON.parse(
      readFileSync(path.join(dir, "index.json"), "utf8")
    ) as { editions: { number?: number }[] };
    expect(raw.editions[0].number).toBe(3);
  });
});
