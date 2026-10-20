import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Chunk, StoredChunk } from "./audioPilot.js";
import { VOICES } from "./audioPilot.js";
import type { WeeklyInput } from "./input.js";
import { spokenText, type EpisodeScript, type Speaker } from "./script.js";

/**
 * Turns the generated chunks into the published episode: one MP3 and one JSON the page reads.
 *
 * Chunks are decoded to PCM before they are joined, so each chunk's offset is its exact sample
 * count rather than an MP3 duration that includes encoder padding — that padding would drift
 * the transcript a few tens of milliseconds per chunk. Loudness is normalised once, over the
 * whole episode, to the podcast target of -16 LUFS; normalisation changes level, not timing.
 */

const SAMPLE_RATE = 44_100;

export interface EpisodeTurn {
  id: string;
  speaker: Speaker;
  start: number;
  end: number;
  text: string;
  /** [start, end] in seconds for each word of `text` split on single spaces. */
  words: Array<[number, number]>;
  refs: string[];
}

export interface WeeklyEpisode {
  schemaVersion: 1;
  weekId: string;
  title: string;
  description: string;
  thesis: string;
  format: string;
  from: string;
  to: string;
  publishedAt: string;
  durationSeconds: number;
  audio: { path: string; bytes: number; sha256: string; mime: "audio/mpeg" };
  speakers: Record<Speaker, { role: string; voice: string }>;
  model: string;
  chapters: Array<{ id: string; title: string; start: number }>;
  turns: EpisodeTurn[];
  sources: Array<{ ref: string; title: string; outlet: string; url: string; itemPath: string }>;
  editionIds: string[];
  credits: { billed: number; scriptChars: number; requests: number };
}

const round = (value: number) => Math.round(value * 100) / 100;

function ffmpeg(args: string[]): string {
  return execFileSync("ffmpeg", ["-hide_banner", "-nostats", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function integratedLoudness(file: string): number | null {
  // ebur128 prints its summary on stderr, so it is folded into stdout for parsing.
  const out = execFileSync("sh", ["-c", `ffmpeg -hide_banner -nostats -i "${file}" -af ebur128 -f null - 2>&1 | tail -12`], {
    encoding: "utf8",
  });
  const match = out.match(/I:\s+(-?\d+(?:\.\d+)?) LUFS/);
  return match ? Number(match[1]) : null;
}

/**
 * Word timings for one turn from the character alignment.
 *
 * The alignment covers the request text exactly as sent, tags included. Tags are skipped, the
 * remaining characters are grouped on whitespace, and the result must line up one-to-one with
 * the transcript words; if it does not, timings are spread across the turn in proportion to
 * word length, which keeps the follow-along usable instead of wrong.
 */
function wordTimes(
  alignment: NonNullable<StoredChunk["alignment"]>,
  from: number,
  to: number,
  offset: number,
  display: string,
  turnStart: number,
  turnEnd: number
): { times: Array<[number, number]>; aligned: boolean } {
  const tokens: Array<[number, number]> = [];
  let inTag = false;
  let start: number | null = null;
  let end = 0;
  for (let i = from; i < to; i += 1) {
    const ch = alignment.characters[i] ?? "";
    if (ch === "[") inTag = true;
    if (inTag) {
      if (ch === "]") inTag = false;
      continue;
    }
    if (/\s/.test(ch)) {
      if (start !== null) tokens.push([start, end]);
      start = null;
      continue;
    }
    if (start === null) start = alignment.character_start_times_seconds[i] ?? 0;
    end = alignment.character_end_times_seconds[i] ?? end;
  }
  if (start !== null) tokens.push([start, end]);

  const words = display.split(" ");
  if (tokens.length === words.length) {
    return { times: tokens.map(([s, e]) => [round(s + offset), round(e + offset)]), aligned: true };
  }
  const total = words.reduce((sum, word) => sum + word.length + 1, 0);
  let cursor = turnStart;
  const times = words.map((word) => {
    const span = ((word.length + 1) / total) * (turnEnd - turnStart);
    const pair: [number, number] = [round(cursor), round(cursor + span)];
    cursor += span;
    return pair;
  });
  return { times, aligned: false };
}

export function assembleEpisode(options: {
  dir: string;
  script: EpisodeScript;
  input: WeeklyInput;
  chunks: Chunk[];
  stored: StoredChunk[];
}): void {
  const { dir, script, input, chunks, stored } = options;
  const work = path.join(dir, "assemble");
  mkdirSync(work, { recursive: true });

  const turns: EpisodeTurn[] = [];
  const loudness: Array<number | null> = [];
  const list: string[] = [];
  let offset = 0;
  let proportional = 0;
  const unvoiced: string[] = [];

  for (const chunk of chunks) {
    const record = stored.find((s) => s.index === chunk.index);
    if (!record?.alignment) throw new Error(`bloco ${chunk.index} sem alinhamento`);
    const mp3 = path.join(dir, "chunks", `${String(chunk.index).padStart(2, "0")}-${record.key}.mp3`);
    const wav = path.join(work, `${chunk.index}.wav`);
    ffmpeg(["-y", "-loglevel", "error", "-i", mp3, "-ac", "1", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", wav]);
    const duration = (statSync(wav).size - 44) / 2 / SAMPLE_RATE;
    loudness.push(integratedLoudness(wav));
    list.push(`file '${wav.replace(/'/g, "'\\''")}'`);

    chunk.turns.forEach((turn, index) => {
      const segments = record.voiceSegments.filter((segment) => segment.dialogue_input_index === index);
      const text = spokenText(turn.text);
      if (segments.length === 0) {
        // The model can swallow a very short input ("Hum."). Keep the line in the transcript,
        // pinned to where it would have been, and report it instead of failing the episode.
        const at = round(turns.at(-1)?.end ?? offset);
        unvoiced.push(turn.id);
        turns.push({ id: turn.id, speaker: turn.speaker, start: at, end: at, text, words: text.split(" ").map(() => [at, at]), refs: turn.refs });
        return;
      }
      const start = Math.min(...segments.map((s) => s.start_time_seconds)) + offset;
      const end = Math.max(...segments.map((s) => s.end_time_seconds)) + offset;
      const from = Math.min(...segments.map((s) => s.character_start_index));
      const to = Math.max(...segments.map((s) => s.character_end_index));
      const words = wordTimes(record.alignment!, from, to, offset, text, start, end);
      if (!words.aligned) proportional += 1;
      turns.push({ id: turn.id, speaker: turn.speaker, start: round(start), end: round(end), text, words: words.times, refs: turn.refs });
    });
    offset += duration;
  }

  const listFile = path.join(work, "list.txt");
  writeFileSync(listFile, `${list.join("\n")}\n`);
  const master = path.join(work, "episode.mp3");
  ffmpeg([
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile,
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", String(SAMPLE_RATE), "-ac", "1", "-b:a", "96k", master,
  ]);
  const audio = readFileSync(master);
  const sha256 = createHash("sha256").update(audio).digest("hex");
  const finalLoudness = integratedLoudness(master);

  const turnById = new Map(turns.map((turn) => [turn.id, turn]));
  const chapters = script.segments.map((segment) => ({
    id: segment.id,
    title: segment.title,
    start: turnById.get(segment.turns[0].id)!.start,
  }));

  const refs = new Set(turns.flatMap((turn) => turn.refs));
  const sources = input.stories
    .filter((story) => refs.has(story.ref))
    .map((story) => ({
      ref: story.ref,
      title: story.item.titlePt?.trim() || story.item.title,
      outlet: story.item.outlet,
      url: story.item.url,
      itemPath: `${story.calendarDate}/${story.slot}/noticia/${story.item.id}`,
    }));
  // Order sources as they are first cited, so the list reads in the order the episode speaks.
  const firstCited = new Map<string, number>();
  turns.forEach((turn, index) => turn.refs.forEach((ref) => firstCited.has(ref) || firstCited.set(ref, index)));
  sources.sort((a, b) => (firstCited.get(a.ref) ?? 0) - (firstCited.get(b.ref) ?? 0));

  const audioName = `episode-${sha256.slice(0, 10)}.mp3`;
  const publicDir = path.join(dir, "public", "weekly", input.weekId);
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(path.join(publicDir, audioName), audio);

  const episode: WeeklyEpisode = {
    schemaVersion: 1,
    weekId: input.weekId,
    title: script.outline.title,
    description: script.outline.description,
    thesis: script.outline.thesis,
    format: script.outline.format,
    from: input.from,
    to: input.to,
    publishedAt: new Date().toISOString(),
    durationSeconds: round(offset),
    audio: { path: `weekly/${input.weekId}/${audioName}`, bytes: audio.length, sha256, mime: "audio/mpeg" },
    speakers: {
      host: { role: VOICES.host.role, voice: VOICES.host.name },
      analyst: { role: VOICES.analyst.role, voice: VOICES.analyst.name },
    },
    model: "eleven_v4",
    chapters,
    turns,
    sources,
    editionIds: input.editionIds,
    credits: { billed: stored.reduce((sum, s) => sum + (s.characterCost ?? s.chars), 0), scriptChars: chunks.reduce((sum, c) => sum + c.chars, 0), requests: chunks.length },
  };
  writeFileSync(path.join(publicDir, "episode.json"), `${JSON.stringify(episode)}\n`);
  writeFileSync(
    path.join(dir, "public", "weekly", "index.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      latestId: input.weekId,
      episodes: [
        {
          weekId: input.weekId,
          title: episode.title,
          description: episode.description,
          from: episode.from,
          to: episode.to,
          durationSeconds: episode.durationSeconds,
          path: `weekly/${input.weekId}/episode.json`,
        },
      ],
    })}\n`
  );

  const report = {
    durationSeconds: round(offset),
    durationLabel: `${Math.floor(offset / 60)} min ${Math.round(offset % 60)} s`,
    charsPerSecond: round(episode.credits.scriptChars / offset),
    bytes: audio.length,
    chunkLoudnessLufs: loudness,
    loudnessSpreadLu: (() => {
      const values = loudness.filter((v): v is number => v !== null);
      return values.length ? round(Math.max(...values) - Math.min(...values)) : null;
    })(),
    finalLoudnessLufs: finalLoudness,
    turns: turns.length,
    turnsWithProportionalWords: proportional,
    turnsWithoutVoice: unvoiced,
    credits: episode.credits,
  };
  writeFileSync(path.join(dir, "audio-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
