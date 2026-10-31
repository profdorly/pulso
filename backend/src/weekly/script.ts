import { z } from "zod";

/**
 * The episode script: the one artifact both the auditor and the voice model read.
 *
 * `text` is what is sent to ElevenLabs, audio tags included, after one deterministic step: the
 * pronunciation map below. The transcript on the site is the same text with the tags removed
 * and the names as written, so the words a listener hears and the words a reader sees cannot
 * drift apart.
 */

export const SPEAKERS = ["host", "analyst"] as const;
export type Speaker = (typeof SPEAKERS)[number];

/**
 * Who each voice is. The interviewer is a man and the specialist a woman; the labels reach the
 * page through episode.json, so changing a role here changes it everywhere.
 */
export const SPEAKER_ROLE: Record<Speaker, { label: string; description: string }> = {
  host: { label: "Apresentador", description: "o APRESENTADOR (homem)" },
  analyst: { label: "Especialista", description: "a ESPECIALISTA (mulher)" },
};

/**
 * Words the voice model must say differently from how they are written.
 *
 * Eleven v4 reads IPA between slashes. The name is "Dôrly" with the stress on the last
 * syllable: closed o, tonic i. Each replacement is a single token, so the word count — and the
 * word-by-word timing of the transcript — stays the same as the written text.
 */
export const PRONUNCIATIONS: Record<string, string> = {
  Dorly: "/doɾˈli/",
};

export const EPISODE_FORMATS = ["panorama", "mergulho", "hibrido"] as const;

export const outlineSchema = z.object({
  format: z.enum(EPISODE_FORMATS),
  /** Why this week calls for this shape — kept for the editor's log, never published. */
  formatReason: z.string(),
  /** The thread a listener should leave with, in one or two sentences. */
  thesis: z.string(),
  title: z.string(),
  description: z.string(),
  segments: z
    .array(
      z.object({
        title: z.string(),
        /** What this block is for in the narrative (context, contrast, consequence…). */
        purpose: z.string(),
        /** What the listener should understand by the end of the block. */
        insight: z.string(),
        refs: z.array(z.string()),
      })
    )
    .min(3)
    .max(5),
});
export type Outline = z.infer<typeof outlineSchema>;

export const turnSchema = z.object({
  speaker: z.enum(SPEAKERS),
  text: z.string(),
  refs: z.array(z.string()),
});

export const scriptSchema = z.object({
  segments: z.array(
    z.object({
      title: z.string(),
      turns: z.array(turnSchema).min(1),
    })
  ),
});
export type ScriptDraft = z.infer<typeof scriptSchema>;

export interface ScriptTurn {
  id: string;
  speaker: Speaker;
  text: string;
  refs: string[];
}

export interface ScriptSegment {
  id: string;
  title: string;
  turns: ScriptTurn[];
}

export interface EpisodeScript {
  weekId: string;
  outline: Outline;
  segments: ScriptSegment[];
}

/**
 * Delivery tags the script may use.
 *
 * A closed list, because v4 reads a bracket as either a delivery cue or a sound effect, and an
 * open vocabulary invites `[applause]` into a news briefing. Everything here is either a way of
 * speaking or a small human sound — a laugh, a sigh — that belongs in a conversation.
 */
export const ALLOWED_TAGS = [
  "warmly",
  "curious",
  "thoughtful",
  "matter-of-fact",
  "emphatic",
  "serious",
  "reflective",
  "intrigued",
  "relaxed",
  "amused",
  "surprised",
  "skeptical",
  "impressed",
  "hesitant",
  "playfully",
  "excited",
  "concerned",
  "laughs softly",
  "chuckles",
  "sighs",
  "exhales",
] as const;

const TAG = /\[([^\]]+)\]/g;

export function tagsIn(text: string): string[] {
  return [...text.matchAll(TAG)].map((match) => match[1].trim().toLowerCase());
}

/** The words a listener hears, as a reader sees them: tags removed, whitespace collapsed. */
export function spokenText(text: string): string {
  return text.replace(TAG, " ").replace(/\s+/g, " ").trim();
}

const PRONUNCIATION_RE = new RegExp(`(?<![\\p{L}\\p{N}])(${Object.keys(PRONUNCIATIONS).join("|")})(?![\\p{L}\\p{N}])`, "gu");

/** What is sent to the voice model: tags kept, names respelled. */
export function ttsText(text: string): string {
  return text.replace(PRONUNCIATION_RE, (word) => PRONUNCIATIONS[word] ?? word);
}

export function numberScript(weekId: string, outline: Outline, draft: ScriptDraft): EpisodeScript {
  return {
    weekId,
    outline,
    segments: draft.segments.map((segment, s) => ({
      id: `seg-${s + 1}`,
      title: segment.title.trim(),
      turns: segment.turns.map((turn, t) => ({
        id: `t${s + 1}-${t + 1}`,
        speaker: turn.speaker,
        text: turn.text.trim(),
        refs: [...new Set(turn.refs)],
      })),
    })),
  };
}

export function allTurns(script: EpisodeScript): ScriptTurn[] {
  return script.segments.flatMap((segment) => segment.turns);
}

/** Human-readable script for review: tags kept, sources listed after each line. */
export function renderScriptText(script: EpisodeScript): string {
  const lines = [`# ${script.outline.title}`, "", script.outline.description, ""];
  for (const segment of script.segments) {
    lines.push(`## ${segment.title}`, "");
    for (const turn of segment.turns) {
      const who = SPEAKER_ROLE[turn.speaker].label.toUpperCase();
      lines.push(`${who}: ${turn.text}${turn.refs.length ? `   (${turn.refs.join(", ")})` : ""}`, "");
    }
  }
  return lines.join("\n");
}
