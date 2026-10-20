import Database from "better-sqlite3";
import dotenv from "dotenv";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { repoRoot } from "../edition/paths.js";
import { argValue, shownPath, userPath } from "./args.js";
import { materializeArtifacts } from "./artifacts.js";
import { downloadPrefix, downloadState, stateTargetFromEnv, WEEKLY_PREFIX } from "./storage.js";

/**
 * Writes the kitchen's editions out as the directory the site build reads, read-only:
 *
 *   npm run kitchen:export -- [--out data/editions] [--from .kitchen-import/news.db]
 *
 * By default the kitchen comes from R2 and the weekly audio's files with it (into `<out>/weekly`).
 * `--from` reads a local kitchen file instead — the import's dry run, say — and skips the weekly.
 * `<out>` is replaced, not merged.
 */

dotenv.config({ path: path.join(repoRoot(), "backend", ".env"), quiet: true });

/**
 * `<out>` is emptied before writing. Only an editions directory (it has an index.json), an empty
 * one, or one that does not exist yet may be emptied — never the repository or a folder above it.
 */
function assertReplaceable(dir: string): void {
  const root = repoRoot();
  if (dir === root || root.startsWith(dir + path.sep)) throw new Error(`--out ${dir} contém o repositório; recusado`);
  if (!existsSync(dir)) return;
  if (readdirSync(dir).length === 0 || existsSync(path.join(dir, "index.json"))) return;
  throw new Error(`--out ${dir} não é um diretório de edições (sem index.json) e não está vazio; recusado`);
}

async function main(): Promise<void> {
  const outValue = argValue("--out");
  const outDir = outValue ? userPath(outValue) : path.join(repoRoot(), "data", "editions");
  assertReplaceable(outDir);
  const from = argValue("--from");
  const target = from ? null : stateTargetFromEnv();
  if (!from && !target) throw new Error("armazenamento da cozinha não configurado (ou use --from <news.db>)");

  const scratch = mkdtempSync(path.join(tmpdir(), "pulso-export-"));
  try {
    let databasePath: string;
    if (from) {
      databasePath = userPath(from);
      if (!existsSync(databasePath)) throw new Error(`cozinha não encontrada: ${databasePath}`);
    } else {
      databasePath = path.join(scratch, "news.db");
      const revision = await downloadState(target!, databasePath);
      if (!revision.exists) throw new Error(`não há cozinha em ${target!.bucket}/${target!.key}`);
    }

    const db = new Database(databasePath, { readonly: true, fileMustExist: true });
    let written: number;
    try {
      written = materializeArtifacts(db, outDir);
    } finally {
      db.close();
    }
    if (!existsSync(path.join(outDir, "index.json"))) throw new Error("a cozinha não tem index.json");

    const weekly = target ? await downloadPrefix(target, WEEKLY_PREFIX, path.join(outDir, "weekly")) : 0;
    process.stdout.write(`edições: ${written} arquivo(s) em ${shownPath(outDir)}; semana: ${weekly}\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
