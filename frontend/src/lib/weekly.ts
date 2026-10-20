import { EditionNotFoundError, fetchJson } from "./editionsApi.js";
import { editionPath } from "./editionPaths.js";
import { editionsUrl } from "./paths.js";

/**
 * The weekly audio episode as published under `editions/weekly/`.
 *
 * Only the lazy weekly modules import this file, so none of it reaches the critical bundle.
 */

export type WeeklySpeaker = "host" | "analyst";

export interface WeeklyTurn {
  id: string;
  speaker: WeeklySpeaker;
  start: number;
  end: number;
  /** Exactly the words spoken, delivery tags removed. */
  text: string;
  /** `[start, end]` in seconds for each word of `text` split on single spaces. */
  words: Array<[number, number]>;
  refs: string[];
}

export interface WeeklySource {
  ref: string;
  title: string;
  outlet: string;
  url: string;
  /** Route of the story page on the Pulso, relative to the site base. */
  itemPath: string;
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
  audio: { path: string; bytes: number; sha256: string; mime: string };
  speakers: Record<WeeklySpeaker, { role: string; voice: string }>;
  model: string;
  chapters: Array<{ id: string; title: string; start: number }>;
  turns: WeeklyTurn[];
  sources: WeeklySource[];
  editionIds: string[];
}

export interface WeeklyIndex {
  schemaVersion: 1;
  latestId: string | null;
  episodes: Array<{
    weekId: string;
    title: string;
    description: string;
    from: string;
    to: string;
    durationSeconds: number;
    path: string;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseEpisode(data: unknown): WeeklyEpisode {
  if (!isRecord(data) || data.schemaVersion !== 1 || !Array.isArray(data.turns) || !isRecord(data.audio)) {
    throw new Error("Episódio inválido");
  }
  return data as unknown as WeeklyEpisode;
}

function parseIndex(data: unknown): WeeklyIndex {
  if (!isRecord(data) || data.schemaVersion !== 1 || !Array.isArray(data.episodes)) {
    throw new Error("Índice de episódios inválido");
  }
  return data as unknown as WeeklyIndex;
}

export function fetchEpisode(weekId: string): Promise<WeeklyEpisode> {
  return fetchJson(editionsUrl(`weekly/${weekId}/episode.json`), parseEpisode);
}

/** `null` when no episode was ever published: the absence is normal, not an error. */
export async function fetchWeeklyIndex(): Promise<WeeklyIndex | null> {
  try {
    return await fetchJson(editionsUrl("weekly/index.json"), parseIndex);
  } catch (err) {
    if (err instanceof EditionNotFoundError) return null;
    throw err;
  }
}

export function episodeAudioUrl(episode: WeeklyEpisode): string {
  return editionsUrl(episode.audio.path);
}

/**
 * Reader route for a cited story.
 *
 * The episode records `<date>/<slot>/noticia/<id>`. A story from a daily edition lives at its date
 * alone (`editionPaths.ts`), so the edition part goes through the shared rule instead of being
 * linked as recorded: the recorded `/<date>/manha/…` still resolves, but only as the legacy
 * address. The rest of the path is kept as is.
 */
export function sourceRoute(source: Pick<WeeklySource, "itemPath">): string {
  const [date = "", slot = "", ...rest] = source.itemPath.split("/");
  return `${editionPath(date, slot)}/${rest.join("/")}`;
}

/** `9:20` or `1:02:03`. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Spoken duration for labels: "9 min". */
export function formatMinutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "28 de setembro a 4 de outubro". */
export function formatWeekRange(from: string, to: string): string {
  const [, fm, fd] = from.split("-").map(Number);
  const [, tm, td] = to.split("-").map(Number);
  if (fm === tm) return `${fd} a ${td} de ${MONTHS[(tm ?? 1) - 1]}`;
  return `${fd} de ${MONTHS[(fm ?? 1) - 1]} a ${td} de ${MONTHS[(tm ?? 1) - 1]}`;
}

/** Index of the last element whose start is at or before `t` (binary search). */
export function indexAt(starts: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((starts[mid] ?? 0) <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
