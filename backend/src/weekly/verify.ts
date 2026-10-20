import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { fold } from "../edition/evidence.js";
import { chunkKey, chunkScript } from "./audioPilot.js";
import { arg, pilotDir } from "./cli.js";
import { isoWeekId } from "./input.js";
import { ALLOWED_TAGS, spokenText, type EpisodeScript } from "./script.js";

/**
 * Listens to the generated audio the only way this pipeline can: by transcribing it and
 * comparing the transcript with the script.
 *
 * It catches what a looser delivery risks — a skipped sentence, words the model made up, a
 * delivery tag read aloud — not pronunciation or tone, which still need a human ear. Speech
 * recognition also tidies speech (it drops some "hum"s and writes numbers its own way), so
 * small differences are expected; only runs of several words in a row are flagged.
 */

const TRANSCRIBE_MODEL = "gpt-4o-transcribe";
/** Consecutive words missing from, or added to, the audio before a run is worth a look. */
const RUN = 4;

/** English words that only reach a Portuguese transcript if a tag was spoken. */
const TAG_WORDS = new Set(
  ALLOWED_TAGS.flatMap((tag) => tag.split(/[\s-]+/)).filter((word) => !["of", "fact", "softly"].includes(word))
);

function words(text: string): string[] {
  return fold(text)
    .replace(/(\d)[.,](?=\d)/g, "$1")
    .replace(/[^\p{L}\p{N}%\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

type Op = { kind: "=" | "s" | "d" | "i"; expected?: string; heard?: string };

/** Word-level edit script between what the script says and what the audio says. */
function align(expected: string[], heard: string[]): Op[] {
  const n = expected.length;
  const m = heard.length;
  const cost: number[][] = Array.from({ length: n + 1 }, (_, i) => {
    const row = new Array<number>(m + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= m; j += 1) cost[0][j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const same = expected[i - 1] === heard[j - 1] ? 0 : 1;
      cost[i][j] = Math.min(cost[i - 1][j - 1] + same, cost[i - 1][j] + 1, cost[i][j - 1] + 1);
    }
  }
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + (expected[i - 1] === heard[j - 1] ? 0 : 1)) {
      ops.push({ kind: expected[i - 1] === heard[j - 1] ? "=" : "s", expected: expected[i - 1], heard: heard[j - 1] });
      i -= 1;
      j -= 1;
    } else if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
      ops.push({ kind: "d", expected: expected[i - 1] });
      i -= 1;
    } else {
      ops.push({ kind: "i", heard: heard[j - 1] });
      j -= 1;
    }
  }
  return ops.reverse();
}

function runs(ops: Op[], kind: "d" | "i"): string[] {
  const found: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length >= RUN) found.push(current.join(" "));
    current = [];
  };
  for (const op of ops) {
    if (op.kind === kind || (op.kind === "s" && current.length > 0)) current.push((kind === "d" ? op.expected : op.heard) ?? "");
    else flush();
  }
  flush();
  return found;
}

export async function runVerify(): Promise<void> {
  const weekId = isoWeekId(arg("--week-start"));
  const dir = pilotDir(weekId);
  const script = JSON.parse(readFileSync(path.join(dir, "script.json"), "utf8")) as EpisodeScript;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY ausente em backend/.env");
  const client = new OpenAI({ apiKey });

  const report = [];
  for (const chunk of chunkScript(script)) {
    const file = path.join(dir, "chunks", `${String(chunk.index).padStart(2, "0")}-${chunkKey(chunk)}.mp3`);
    if (!existsSync(file)) throw new Error(`bloco ${chunk.index} ainda não foi gerado`);
    const transcription = await client.audio.transcriptions.create({
      file: createReadStream(file),
      model: TRANSCRIBE_MODEL,
      language: "pt",
      // Without server-side chunking the model can stop at the first long pause and return a
      // single sentence, which reads as if the audio had skipped everything after it.
      chunking_strategy: "auto",
    });
    const expected = words(chunk.turns.map((turn) => spokenText(turn.text)).join(" "));
    const heard = words(transcription.text);
    const ops = align(expected, heard);
    const errors = ops.filter((op) => op.kind !== "=").length;
    const entry = {
      chunk: chunk.index,
      turns: `${chunk.turns[0].id}…${chunk.turns.at(-1)!.id}`,
      wordErrorRate: Math.round((errors / Math.max(1, expected.length)) * 1000) / 10,
      skipped: runs(ops, "d"),
      added: runs(ops, "i"),
      tagWordsHeard: heard.filter((word) => TAG_WORDS.has(word)),
      transcript: transcription.text,
    };
    report.push(entry);
    const flags = [
      entry.skipped.length ? `${entry.skipped.length} trecho(s) pulado(s)` : null,
      entry.added.length ? `${entry.added.length} trecho(s) a mais` : null,
      entry.tagWordsHeard.length ? `tag falada: ${entry.tagWordsHeard.join(", ")}` : null,
    ].filter(Boolean);
    console.log(`  bloco ${chunk.index} (${entry.turns}): ${entry.wordErrorRate}% de diferença${flags.length ? ` — ${flags.join("; ")}` : ""}`);
    for (const run of entry.skipped) console.log(`      pulado: "${run}"`);
    for (const run of entry.added) console.log(`      a mais: "${run}"`);
  }
  writeFileSync(path.join(dir, "verify.json"), `${JSON.stringify(report, null, 2)}\n`);
  const opening = report[0]?.transcript.split(/\s+/).slice(0, 40).join(" ") ?? "";
  console.log(`\nabertura transcrita: "${opening}…"`);
}
