import type { Db } from "../client.js";
import type { BenchmarkSnapshot } from "../../types.js";

export interface BenchmarkSnapshotRow {
  id: string;
  provider: string;
  captured_at: string;
  payload: string;
}

function rowToSnapshot(row: BenchmarkSnapshotRow): BenchmarkSnapshot {
  return {
    id: row.id,
    provider: row.provider as BenchmarkSnapshot["provider"],
    capturedAt: row.captured_at,
    payload: JSON.parse(row.payload) as BenchmarkSnapshot["payload"],
  };
}

export function createBenchmarkSnapshotsRepository(db: Db) {
  return {
    insert(snapshot: BenchmarkSnapshot): void {
      db
        .prepare(
          `
          INSERT INTO benchmark_snapshots (id, provider, captured_at, payload)
          VALUES (@id, @provider, @captured_at, @payload)
        `
        )
        .run({
          id: snapshot.id,
          provider: snapshot.provider,
          captured_at: snapshot.capturedAt,
          payload: JSON.stringify(snapshot.payload),
        });
    },

    findLatest(): BenchmarkSnapshot | undefined {
      const row = db
        .prepare(`
          SELECT * FROM benchmark_snapshots
          ORDER BY captured_at DESC, id DESC
          LIMIT 1
        `)
        .get() as BenchmarkSnapshotRow | undefined;
      return row ? rowToSnapshot(row) : undefined;
    },

    /** The snapshot captured immediately before `capturedAt`, for delta reporting. */
    findPreviousBefore(capturedAt: string): BenchmarkSnapshot | undefined {
      const row = db
        .prepare<{ capturedAt: string }>(`
          SELECT * FROM benchmark_snapshots
          WHERE captured_at < @capturedAt
          ORDER BY captured_at DESC, id DESC
          LIMIT 1
        `)
        .get({ capturedAt }) as BenchmarkSnapshotRow | undefined;
      return row ? rowToSnapshot(row) : undefined;
    },

    findByDate(date: string): BenchmarkSnapshot | undefined {
      const row = db
        .prepare<{ date: string }>(`
          SELECT * FROM benchmark_snapshots
          WHERE date(captured_at) = date(@date)
          ORDER BY captured_at DESC
          LIMIT 1
        `)
        .get({ date }) as BenchmarkSnapshotRow | undefined;
      return row ? rowToSnapshot(row) : undefined;
    },

    findById(id: string): BenchmarkSnapshot | undefined {
      const row = db
        .prepare<Pick<BenchmarkSnapshotRow, "id">>(`SELECT * FROM benchmark_snapshots WHERE id = @id`)
        .get({ id }) as BenchmarkSnapshotRow | undefined;
      return row ? rowToSnapshot(row) : undefined;
    },

    clear(): void {
      db.exec(`DELETE FROM benchmark_snapshots`);
    },
  };
}

export type BenchmarkSnapshotsRepository = ReturnType<typeof createBenchmarkSnapshotsRepository>;
