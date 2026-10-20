import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "../test-helper.js";
import type { BenchmarkSnapshot } from "../../types.js";

function makeSnapshot(overrides: Partial<BenchmarkSnapshot> = {}): BenchmarkSnapshot {
  return {
    id: "snapshot-1",
    provider: "artificial-analysis",
    capturedAt: "2026-08-14T12:00:00.000Z",
    payload: {
      rows: [
        {
          modelId: "gpt-5",
          name: "GPT-5",
          creator: "OpenAI",
          region: "us",
          intelligenceIndex: 85,
        },
      ],
    },
    ...overrides,
  };
}

describe("benchmarkSnapshots repository", () => {
  let testDb: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it("inserts and retrieves the latest snapshot", () => {
    const snapshot = makeSnapshot();
    testDb.repositories.benchmarkSnapshots.insert(snapshot);
    const found = testDb.repositories.benchmarkSnapshots.findLatest();
    expect(found).toEqual(snapshot);
  });

  it("returns the latest snapshot by captured_at", () => {
    const older = makeSnapshot({ id: "older", capturedAt: "2026-08-13T12:00:00.000Z" });
    const newer = makeSnapshot({ id: "newer", capturedAt: "2026-08-14T12:00:00.000Z" });
    testDb.repositories.benchmarkSnapshots.insert(older);
    testDb.repositories.benchmarkSnapshots.insert(newer);
    const found = testDb.repositories.benchmarkSnapshots.findLatest();
    expect(found?.id).toBe("newer");
  });

  it("finds a snapshot by date", () => {
    const snapshot = makeSnapshot({ capturedAt: "2026-08-14T10:30:00.000Z" });
    testDb.repositories.benchmarkSnapshots.insert(snapshot);
    const found = testDb.repositories.benchmarkSnapshots.findByDate("2026-08-14");
    expect(found?.id).toBe(snapshot.id);
  });

  it("finds a snapshot by id", () => {
    const snapshot = makeSnapshot();
    testDb.repositories.benchmarkSnapshots.insert(snapshot);
    const found = testDb.repositories.benchmarkSnapshots.findById(snapshot.id);
    expect(found).toEqual(snapshot);
  });
});
