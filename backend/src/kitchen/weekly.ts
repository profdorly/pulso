import dotenv from "dotenv";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../edition/paths.js";
import { argValue, hasFlag, shownPath, userPath } from "./args.js";
import { deleteObject, listKeys, readObject, stateTargetFromEnv, WEEKLY_PREFIX, writeObject } from "./storage.js";
import { mergeWeeklyIndex, parseWeeklyIndex } from "./weeklyIndex.js";

/**
 * Publishes an episode of the weekly audio to the kitchen's bucket, beside the kitchen file:
 *
 *   npm run kitchen:weekly -- --from .tmp/weekly-audio-pilot/2026-W41 [--dry-run]
 *
 * `--from` is a pilot output (its `public/weekly/`) or that `weekly/` folder itself. The episode
 * files go first and the merged index last, so the site never lists an episode it cannot load.
 * The next site build picks it up; the kitchen file itself is not touched.
 */

dotenv.config({ path: path.join(repoRoot(), "backend", ".env"), quiet: true });

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".mp3": "audio/mpeg",
};

function weeklyDirOf(from: string): string {
  for (const candidate of [from, path.join(from, "public", "weekly")]) {
    if (existsSync(path.join(candidate, "index.json"))) return candidate;
  }
  throw new Error(`${from} não tem index.json nem public/weekly/index.json`);
}

async function main(): Promise<void> {
  const fromValue = argValue("--from");
  if (!fromValue) throw new Error("faltou --from (saída do piloto do Pulso da Semana)");
  const dir = weeklyDirOf(userPath(fromValue));
  const incoming = parseWeeklyIndex(JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8")), shownPath(dir));
  const dryRun = hasFlag("--dry-run");

  const files: Array<{ key: string; file: string }> = [];
  for (const episode of incoming.episodes) {
    const episodeDir = path.join(dir, episode.weekId);
    if (!existsSync(path.join(episodeDir, "episode.json"))) throw new Error(`${episode.weekId}: episode.json ausente em ${shownPath(episodeDir)}`);
    for (const name of readdirSync(episodeDir)) {
      const file = path.join(episodeDir, name);
      if (statSync(file).isFile()) files.push({ key: `${WEEKLY_PREFIX}${episode.weekId}/${name}`, file });
    }
  }

  const target = stateTargetFromEnv();
  if (!target) throw new Error("armazenamento da cozinha não configurado");
  const storedRaw = await readObject(target, `${WEEKLY_PREFIX}index.json`);
  const stored = storedRaw ? parseWeeklyIndex(JSON.parse(storedRaw.toString("utf8")), "índice publicado") : null;
  const merged = mergeWeeklyIndex(stored, incoming);

  // A week published again (a corrected episode) leaves its old MP3 behind under a different
  // hashed name. Nothing references it, but every site build would still ship it.
  const uploading = new Set(files.map(({ key }) => key));
  const stale: string[] = [];
  for (const episode of incoming.episodes) {
    for (const key of await listKeys(target, `${WEEKLY_PREFIX}${episode.weekId}/`)) {
      if (!uploading.has(key)) stale.push(key);
    }
  }

  for (const { key } of files) process.stdout.write(`${dryRun ? "enviaria" : "enviando"} ${key}\n`);
  for (const key of stale) process.stdout.write(`${dryRun ? "apagaria" : "apagando"} ${key} (versão anterior)\n`);
  process.stdout.write(`índice: ${merged.episodes.map((episode) => episode.weekId).join(", ")}\n`);
  if (dryRun) return;

  for (const { key, file } of files) {
    await writeObject(target, key, readFileSync(file), CONTENT_TYPES[path.extname(file)]);
  }
  await writeObject(target, `${WEEKLY_PREFIX}index.json`, Buffer.from(`${JSON.stringify(merged)}\n`), "application/json");
  // Last: until the new index is up, the site may still be pointing at the old files.
  for (const key of stale) await deleteObject(target, key);
  process.stdout.write("semana: publicada; entra no site na próxima publicação (ou rode o workflow com tarefa: site)\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
