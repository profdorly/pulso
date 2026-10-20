import dotenv from "dotenv";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { initializeDb } from "../db/index.js";
import { repoRoot } from "../edition/paths.js";
import { argValue, hasFlag, shownPath, userPath } from "./args.js";
import { captureArtifacts, clearArtifacts } from "./artifacts.js";
import { prepareLegacyEditions } from "./legacy.js";
import { compactState } from "./policy.js";
import { backupState, headState, stateTargetFromEnv, uploadDir, uploadState, WEEKLY_PREFIX } from "./storage.js";

/**
 * One-time import of the AWS kitchen into the new one. Reads local copies only — fetching them
 * from S3 is a separate `aws s3 cp`, so this file never needs AWS credentials:
 *
 *   npm run kitchen:import -- --db old/news.db --editions old/editions \
 *     --public-index https://dorly.com.br/pulso/editions/index.json \
 *     [--weekly old/editions/weekly] [--dry-run] [--replace]
 *
 * Builds the new kitchen file in $KITCHEN_DIR (default `.kitchen-import`): the old database with
 * the current schema, the daily editions renumbered to their public numbers stored inside it,
 * stale items forgotten. `--dry-run` stops there; otherwise it is uploaded to R2, refusing to
 * overwrite an existing kitchen unless `--replace` is given. `--weekly` also uploads the weekly
 * audio's files, which live beside the kitchen rather than inside it.
 */

dotenv.config({ path: path.join(repoRoot(), "backend", ".env"), quiet: true });

function required(flag: string): string {
  const value = argValue(flag);
  if (!value) throw new Error(`faltou ${flag}`);
  return userPath(value);
}

async function readPublicIndex(source: string): Promise<unknown> {
  if (/^https:\/\//i.test(source)) {
    const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`índice público: HTTP ${response.status}`);
    return response.json();
  }
  return JSON.parse(readFileSync(userPath(source), "utf8")) as unknown;
}

async function main(): Promise<void> {
  const sourceDb = required("--db");
  const sourceEditions = required("--editions");
  const publicIndexSource = argValue("--public-index");
  if (!publicIndexSource) throw new Error("faltou --public-index (arquivo ou URL do índice do site público)");
  const weeklyDir = argValue("--weekly") ? required("--weekly") : null;
  const dryRun = hasFlag("--dry-run");
  const replace = hasFlag("--replace");
  if (!existsSync(sourceDb)) throw new Error(`banco não encontrado: ${sourceDb}`);
  if (weeklyDir && !existsSync(path.join(weeklyDir, "index.json"))) throw new Error(`--weekly sem index.json: ${weeklyDir}`);

  const target = dryRun ? null : stateTargetFromEnv();
  if (!dryRun && !target) throw new Error("armazenamento da cozinha não configurado (ou use --dry-run)");

  const workDir = path.resolve(process.env.KITCHEN_DIR ?? path.join(repoRoot(), ".kitchen-import"));
  const databasePath = path.join(workDir, "news.db");
  const editionsDir = path.join(workDir, "editions");
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  copyFileSync(sourceDb, databasePath);

  const report = prepareLegacyEditions({
    sourceDir: sourceEditions,
    outDir: editionsDir,
    publicIndex: await readPublicIndex(publicIndexSource),
  });
  for (const edition of report.editions) {
    const from = edition.kitchenNumber === undefined ? "sem número" : `#${edition.kitchenNumber}`;
    process.stdout.write(`${edition.id}: ${from} → #${edition.number}${edition.cover ? "" : " (sem capa)"}\n`);
  }
  if (report.missingCovers.length > 0) throw new Error(`capas ausentes: ${report.missingCovers.join(", ")}`);
  if (!report.catalog) process.stdout.write("aviso: sem models.json; /modelos fica vazio até a próxima segunda\n");

  const { db, repositories } = initializeDb({ DATABASE_PATH: databasePath });
  try {
    clearArtifacts(db);
    const stored = captureArtifacts(db, editionsDir);
    const forgotten = compactState(db, repositories);
    const items = (db.prepare("SELECT COUNT(*) AS n FROM news_items").get() as { n: number }).n;
    process.stdout.write(`cozinha: ${stored.length} artefato(s), ${items} item(ns), ${forgotten} esquecido(s)\n`);
  } finally {
    db.close();
  }

  if (!target) {
    process.stdout.write(`ensaio: nada enviado; cozinha pronta em ${shownPath(databasePath)}\n`);
    return;
  }

  const current = await headState(target);
  if (current.exists && !replace) throw new Error(`já existe uma cozinha em ${target.bucket}/${target.key}; use --replace para substituí-la`);
  await uploadState(target, databasePath, current);
  const backup = await backupState(target, databasePath);
  process.stdout.write(`cozinha: enviada para ${target.bucket}/${target.key}; cópia em ${backup}\n`);

  if (weeklyDir) {
    const sent = await uploadDir(target, weeklyDir, WEEKLY_PREFIX);
    process.stdout.write(`semana: ${sent} arquivo(s) enviados para ${WEEKLY_PREFIX}\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
