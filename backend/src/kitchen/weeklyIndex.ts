/**
 * The weekly audio's index: every episode published, newest first. The pilot writes an index
 * with only the episode it just made; publishing it as-is would hide every earlier one.
 */

export interface WeeklyEpisodeEntry {
  weekId: string;
  path: string;
  [key: string]: unknown;
}

export interface WeeklyIndex {
  schemaVersion: 1;
  latestId: string | null;
  episodes: WeeklyEpisodeEntry[];
}

const WEEK_ID = /^\d{4}-W\d{2}$/;

export function parseWeeklyIndex(raw: unknown, label: string): WeeklyIndex {
  const value = raw as Partial<WeeklyIndex> | null;
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.episodes)) {
    throw new Error(`${label}: índice semanal inválido`);
  }
  for (const episode of value.episodes) {
    if (typeof episode?.weekId !== "string" || !WEEK_ID.test(episode.weekId) || typeof episode.path !== "string") {
      throw new Error(`${label}: episódio inválido no índice`);
    }
  }
  return value as WeeklyIndex;
}

/** `incoming` replaces any episode of the same week in `stored`; the result is newest first. */
export function mergeWeeklyIndex(stored: WeeklyIndex | null, incoming: WeeklyIndex): WeeklyIndex {
  const byWeek = new Map<string, WeeklyEpisodeEntry>();
  for (const episode of stored?.episodes ?? []) byWeek.set(episode.weekId, episode);
  for (const episode of incoming.episodes) byWeek.set(episode.weekId, episode);
  const episodes = [...byWeek.values()].sort((a, b) => b.weekId.localeCompare(a.weekId));
  return { schemaVersion: 1, latestId: episodes[0]?.weekId ?? null, episodes };
}
