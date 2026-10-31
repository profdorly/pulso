import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ELEVEN_MODEL, ElevenLabsClient, type DialogueInput, type DialogueResult, type DialogueSettings } from "./elevenlabs.js";
import type { WeeklyInput } from "./input.js";
import { fileSha256, pilotDir } from "./cli.js";
import { APPROVAL_FILE, type ScriptStatus } from "./pilot.js";
import { SPEAKER_ROLE, spokenText, ttsText, type EpisodeScript, type ScriptTurn, type Speaker } from "./script.js";

/**
 * Voices for the pilot: Brazilian accents from the ElevenLabs library, both verified by
 * ElevenLabs for Portuguese on `eleven_v4`. The interviewer is a man, the specialist a woman.
 * The first pilot's analyst (Marcelo Costa) was not verified for v4, which is one reason he
 * was replaced.
 */
export const VOICES: Record<Speaker, { id: string; name: string; role: string }> = {
  host: { id: "Qrdut83w0Cr152Yb4Xn3", name: "Paulo", role: SPEAKER_ROLE.host.label },
  analyst: { id: "RGymW84CSmfVugnA5tvA", name: "Roberta", role: SPEAKER_ROLE.analyst.label },
};

/**
 * Below the default 0.5 for a wider emotional range, which is what keeps a conversation from
 * sounding read. Lower still risks the model drifting from the text; the verify step checks.
 */
export const DIALOGUE_SETTINGS: DialogueSettings = { stability: 0.4, similarity: 0.75 };

/** Below the documented 2,000-character reliability limit, with room for tags. */
export const CHUNK_MAX_CHARS = 1_800;
/** A segment boundary starts a new request once the current one has this much text. */
const CHUNK_SOFT_BREAK = 900;
const SEED = 4040;

export interface Chunk {
  index: number;
  turns: ScriptTurn[];
  chars: number;
}

/** Packs turns into requests, never splitting a turn and preferring segment boundaries. */
export function chunkScript(script: EpisodeScript): Chunk[] {
  const chunks: Chunk[] = [];
  let current: ScriptTurn[] = [];
  let chars = 0;
  const flush = () => {
    if (current.length) chunks.push({ index: chunks.length, turns: current, chars });
    current = [];
    chars = 0;
  };
  for (const segment of script.segments) {
    if (chars >= CHUNK_SOFT_BREAK) flush();
    for (const turn of segment.turns) {
      if (chars + turn.text.length > CHUNK_MAX_CHARS) flush();
      current.push(turn);
      chars += turn.text.length;
    }
  }
  flush();
  return chunks;
}

function chunkInputs(chunk: Chunk): DialogueInput[] {
  return chunk.turns.map((turn) => ({ text: ttsText(turn.text), voice_id: VOICES[turn.speaker].id }));
}

/** Everything that changes the audio is in the key, so a cached chunk is reused only when identical. */
export function chunkKey(chunk: Chunk): string {
  const payload = JSON.stringify({ model: ELEVEN_MODEL, seed: SEED, settings: DIALOGUE_SETTINGS, inputs: chunkInputs(chunk) });
  return createHash("sha256").update(payload).digest("hex").slice(0, 12);
}

export interface StoredChunk {
  index: number;
  key: string;
  requestId: string | null;
  characterCost: number | null;
  chars: number;
  headers: Record<string, string>;
  alignment: DialogueResult["alignment"];
  voiceSegments: DialogueResult["voiceSegments"];
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

/**
 * Refuses to spend a credit on a script nobody approved, or on one that changed after the
 * checks or the approval. The hashes are of `script.json` itself, so an edit of a single comma
 * after approval stops the audio until the script is checked and approved again.
 */
export function assertApproved(dir: string): void {
  const scriptFile = path.join(dir, "script.json");
  const statusFile = path.join(dir, "script-status.json");
  const approvalFile = path.join(dir, APPROVAL_FILE);
  if (!existsSync(scriptFile) || !existsSync(statusFile)) throw new Error("não há roteiro checado; rode `npm run semana -- roteiro`");
  const status = readJson<Partial<ScriptStatus>>(statusFile);
  const current = fileSha256(scriptFile);
  if (!status.passed) throw new Error("o roteiro não passou nas checagens; corrija e rode `npm run semana -- checar`");
  if (status.scriptSha256 !== current) throw new Error("script.json mudou depois da checagem; rode `npm run semana -- checar`");
  if (!existsSync(approvalFile)) throw new Error("o roteiro ainda não foi aprovado; só a pessoa responsável aprova (`npm run semana -- aprovar`)");
  const approval = readJson<{ scriptSha256?: string }>(approvalFile);
  if (approval.scriptSha256 !== current) throw new Error("a aprovação é de outra versão do roteiro; leia de novo e aprove esta");
}

interface CreditsRun {
  at: string;
  before: number;
  after: number;
  billed: number;
  scriptChars: number;
  chunks: number;
  tier?: string;
  limit?: number;
}

/** Credits spent on this week, every run kept: a rerun that pays again must show up. */
function appendCredits(dir: string, run: CreditsRun): { billed: number; runs: CreditsRun[] } {
  const file = path.join(dir, "credits.json");
  const previous = existsSync(file) ? readJson<{ runs?: CreditsRun[] } & Partial<CreditsRun>>(file) : null;
  // The pilot wrote a single run as the whole file.
  const runs = previous?.runs ?? (previous?.billed !== undefined ? [{ at: "", ...previous } as CreditsRun] : []);
  runs.push(run);
  const result = { billed: runs.reduce((sum, r) => sum + r.billed, 0), runs };
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export async function runAudio(weekId: string, options: { maxCredits: number; onlyFirst?: boolean }): Promise<void> {
  const dir = pilotDir(weekId);
  assertApproved(dir);
  const script = readJson<EpisodeScript>(path.join(dir, "script.json"));
  const input = readJson<WeeklyInput>(path.join(dir, "weekly-input.json"));
  const maxCredits = options.maxCredits;
  const onlyFirst = options.onlyFirst ?? false;

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY ausente em .env.local");
  const client = new ElevenLabsClient(apiKey);

  const chunks = chunkScript(script);
  const total = chunks.reduce((sum, chunk) => sum + chunk.chars, 0);
  console.log(`${chunks.length} requisições, ${total} caracteres, teto ${maxCredits}`);
  if (total > maxCredits) throw new Error(`o roteiro custaria ${total} créditos, acima do teto de ${maxCredits}`);

  const before = await client.subscription();
  console.log(`saldo antes: ${before.used}/${before.limit} usados`);

  const chunkDir = path.join(dir, "chunks");
  mkdirSync(chunkDir, { recursive: true });
  const stored: StoredChunk[] = [];
  let spentThisRun = 0;

  for (const chunk of chunks) {
    const key = chunkKey(chunk);
    const base = path.join(chunkDir, `${String(chunk.index).padStart(2, "0")}-${key}`);
    if (existsSync(`${base}.json`) && existsSync(`${base}.mp3`)) {
      // Already generated from identical text: reusing it is what keeps a rerun from paying twice.
      stored.push(readJson<StoredChunk>(`${base}.json`));
      console.log(`  bloco ${chunk.index}: reaproveitado`);
      if (onlyFirst) break;
      continue;
    }
    if (spentThisRun + chunk.chars > maxCredits) throw new Error("teto de créditos atingido; parando antes da chamada");

    const previous = chunks[chunk.index - 1];
    const next = chunks[chunk.index + 1];
    const started = Date.now();
    const result = await client.dialogue({
      inputs: chunkInputs(chunk),
      seed: SEED,
      settings: DIALOGUE_SETTINGS,
      previousRequestIds: stored.map((s) => s.requestId).filter((id): id is string => Boolean(id)),
      ...(previous ? { previousText: spokenText(ttsText(previous.turns.at(-1)!.text)) } : {}),
      ...(next ? { futureText: spokenText(ttsText(next.turns[0].text)) } : {}),
    });
    spentThisRun += chunk.chars;
    const record: StoredChunk = {
      index: chunk.index,
      key,
      requestId: result.requestId,
      characterCost: result.characterCost,
      chars: chunk.chars,
      headers: result.headers,
      alignment: result.alignment,
      voiceSegments: result.voiceSegments,
    };
    writeFileSync(`${base}.mp3`, result.audio);
    writeFileSync(`${base}.json`, `${JSON.stringify(record)}\n`);
    stored.push(record);
    console.log(
      `  bloco ${chunk.index}: ${chunk.chars} caracteres, ${((Date.now() - started) / 1000).toFixed(1)} s, ` +
        `custo informado ${result.characterCost ?? "?"}, request ${result.requestId ?? "?"}`
    );
    if (onlyFirst) break;
  }

  const after = await client.subscription();
  const billed = after.used - before.used;
  console.log(`saldo depois: ${after.used}/${after.limit} usados (${billed} nesta execução)`);
  const credits = appendCredits(dir, {
    at: new Date().toISOString(),
    before: before.used,
    after: after.used,
    billed,
    scriptChars: total,
    chunks: chunks.length,
    tier: after.tier,
    limit: after.limit,
  });
  if (credits.runs.length > 1) console.log(`créditos na semana, somando as execuções: ${credits.billed}`);
  if (onlyFirst) return;

  const { assembleEpisode } = await import("./assemble.js");
  assembleEpisode({ dir, script, input, chunks, stored });
}
