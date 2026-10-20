import { rmSync } from "node:fs";
import path from "node:path";
import { initializeDb } from "../db/index.js";
import type { PulsoJobInput } from "../edition/job.js";
import type { EditionJobResult } from "../edition/schema.js";
import { createEditionStore, type EditionStore } from "../edition/store.js";
import { captureArtifacts, materializeArtifacts } from "./artifacts.js";
import { catalogueDue, compactState, shouldPublishSite } from "./policy.js";
import { backupState, downloadState, pruneBackups, uploadState, type StateTarget } from "./storage.js";

/**
 * One kitchen run, as the scheduled workflow does it:
 *
 *   download the kitchen (one SQLite file) → write its editions directory out → capture the
 *   model catalogue if it is due → run the edition → store the editions back in the file →
 *   forget items no feed has shown in 90 days → upload, conditional on the version downloaded →
 *   keep a dated copy.
 *
 * The upload is the commit point. Before it, any failure leaves the stored kitchen exactly as it
 * was. After it, nothing can undo the run: the dated copy and the pruning of old copies are
 * housekeeping, and their failure is reported, not raised.
 */

export type KitchenMode =
  /** Catalogue when due (Mondays), then the edition. */
  | "daily"
  /** Only the catalogue, now. */
  | "catalogue";

export interface DailyOptions {
  target: StateTarget;
  workDir: string;
  mode: KitchenMode;
  /** Rewrite today's edition even if it exists. */
  force?: boolean;
  /** Allow starting from no kitchen at all. Without it, a missing kitchen is an error. */
  init?: boolean;
  now?: Date;
  runJob: (input: PulsoJobInput) => Promise<EditionJobResult>;
  log?: (line: string) => void;
}

export interface DailyResult {
  uploaded: boolean;
  /** The run wrote something the site shows. */
  publish: boolean;
  catalogue: "captured" | "failed" | "skipped";
  /** Newest edition in the kitchen after the run: what the live site should show. */
  latestEditionId: string | null;
  /** Housekeeping that failed after the commit. */
  warnings: string[];
}

export class MissingKitchenError extends Error {
  constructor(target: StateTarget) {
    super(
      `não há cozinha em ${target.bucket}/${target.key}. Se é a primeira corrida, rode com --init; ` +
        "senão, confira o bucket e a chave antes de começar do zero."
    );
    this.name = "MissingKitchenError";
  }
}

function catalogueCapturedAt(store: EditionStore): string | undefined {
  try {
    return store.readCatalog()?.capturedAt;
  } catch {
    return undefined;
  }
}

export async function runDaily(options: DailyOptions): Promise<DailyResult> {
  const log = options.log ?? (() => {});
  const now = options.now ?? new Date();
  const workDir = path.resolve(options.workDir);
  const databasePath = path.join(workDir, "news.db");
  const editionsDir = path.join(workDir, "editions");
  rmSync(workDir, { recursive: true, force: true });

  const revision = await downloadState(options.target, databasePath);
  if (!revision.exists && !options.init) throw new MissingKitchenError(options.target);

  const { db, repositories } = initializeDb({ DATABASE_PATH: databasePath });
  const store = createEditionStore(editionsDir);
  const job = (extra: Pick<PulsoJobInput, "benchmarksOnly" | "force">) =>
    options.runJob({
      slot: "manha",
      repositories,
      editionsDir,
      lockPath: path.join(workDir, "edition.lock"),
      ...extra,
    });

  let catalogue: DailyResult["catalogue"] = "skipped";
  let editionWrote = false;
  let upload = true;
  try {
    const restored = materializeArtifacts(db, editionsDir);
    log(`cozinha: ${revision.exists ? "baixada" : "nova"}, ${restored} artefato(s)`);

    const before = catalogueCapturedAt(store);
    if (options.mode === "catalogue" || catalogueDue(before, now)) {
      const result = await job({ benchmarksOnly: true, force: false });
      log(`modelos: ${JSON.stringify(result)}`);
      catalogue = catalogueCapturedAt(store) !== before ? "captured" : "failed";
    }

    if (options.mode === "daily") {
      const result = await job({ benchmarksOnly: false, force: options.force ?? false });
      log(`edição: ${JSON.stringify(result)}`);
      if (result.skippedReason === "slot-already-published") {
        // A second run on a day that has its edition (the catch-up, a manual run) is not a
        // failure. Unless it captured the catalogue, nothing it did is worth keeping.
        log("cozinha: a edição de hoje já saiu (use --force para refazê-la)");
        upload = catalogue === "captured";
      } else if (result.status === "error") {
        throw new Error(`edição falhou: ${result.error ?? result.skippedReason ?? "sem detalhe"}`);
      } else {
        editionWrote = shouldPublishSite(result);
      }
    }

    if (upload) {
      const changed = captureArtifacts(db, editionsDir);
      const forgotten = compactState(db, repositories, now);
      log(`cozinha: ${changed.length} artefato(s) gravado(s), ${forgotten} item(ns) esquecido(s)`);
    }
  } finally {
    db.close();
  }

  const latestEditionId = store.readIndex().latestId;
  const publish = catalogue === "captured" || editionWrote;
  if (!upload) {
    log("cozinha: nada enviado");
    return { uploaded: false, publish, catalogue, latestEditionId, warnings: [] };
  }

  await uploadState(options.target, databasePath, revision);
  log("cozinha: enviada");

  const warnings: string[] = [];
  try {
    log(`cozinha: cópia em ${await backupState(options.target, databasePath, now)}`);
  } catch (error) {
    warnings.push(`cópia diária falhou: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const pruned = await pruneBackups(options.target, now);
    if (pruned.length > 0) log(`cozinha: ${pruned.length} cópia(s) antiga(s) removida(s)`);
  } catch (error) {
    warnings.push(`limpeza das cópias falhou: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { uploaded: true, publish, catalogue, latestEditionId, warnings };
}
