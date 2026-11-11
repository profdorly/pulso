import { z } from "zod";
import { urlKey } from "../edition/webSearchShadow.js";

/**
 * Reads what the web search beyond the feeds did in shadow mode, from the run logs.
 *
 * Each edition run prints one JSON line (`pulso-web-search-shadow`, see webSearchShadow.ts) with
 * the stories that passed every check and would have competed for a slot, and why the rest did
 * not. A week of those lines answers the question the shadow mode exists for: how many stories a
 * day the search really adds, from where, before it is allowed onto the cover.
 */

const MARKER = '{"type":"pulso-web-search-shadow"';

const wouldAddSchema = z.object({
  title: z.string(),
  url: z.string(),
  outlet: z.string(),
  region: z.string(),
  language: z.string(),
  publishedAt: z.string(),
  searchRegion: z.string(),
});

const reportSchema = z.object({
  type: z.literal("pulso-web-search-shadow"),
  editionId: z.string().optional(),
  window: z.object({ start: z.string(), end: z.string() }),
  model: z.string(),
  searches: z.number(),
  candidates: z.number(),
  errors: z.array(z.string()).default([]),
  wouldAdd: z.array(wouldAddSchema),
  counts: z.record(z.string(), z.number()),
});

export type ShadowLogReport = z.infer<typeof reportSchema>;

/** The shadow reports in a run's log text, and how many marked lines could not be read. */
export function parseShadowReports(logText: string): { reports: ShadowLogReport[]; unreadable: number } {
  const reports: ShadowLogReport[] = [];
  let unreadable = 0;
  for (const line of logText.split("\n")) {
    const start = line.indexOf(MARKER);
    if (start < 0) continue;
    try {
      const parsed = reportSchema.safeParse(JSON.parse(line.slice(start).trim()));
      if (parsed.success) reports.push(parsed.data);
      else unreadable += 1;
    } catch {
      unreadable += 1;
    }
  }
  return { reports, unreadable };
}

/** One report per edition, the last one: a rerun of the same edition replaces the earlier run. */
export function latestPerEdition(reports: readonly ShadowLogReport[]): ShadowLogReport[] {
  const byEdition = new Map<string, ShadowLogReport>();
  reports.forEach((report, index) => byEdition.set(report.editionId ?? `sem-id-${index}`, report));
  return [...byEdition.values()].sort((a, b) => a.window.end.localeCompare(b.window.end));
}

export interface ShadowSummary {
  editions: number;
  /** Stories that passed every check, each counted once even when two windows both found it. */
  uniqueStories: number;
  perEdition: Array<{
    editionId: string;
    model: string;
    searches: number;
    candidates: number;
    wouldAdd: number;
    errors: number;
  }>;
  /** Rejections summed over the editions, by reason. */
  rejected: Record<string, number>;
  bySearchRegion: Array<[string, number]>;
  byLanguage: Array<[string, number]>;
  topOutlets: Array<[string, number]>;
  /** Unique stories per edition. */
  averagePerEdition: number;
}

function tally(values: readonly string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function summarizeShadow(reports: readonly ShadowLogReport[]): ShadowSummary {
  const stories = new Map<string, ShadowLogReport["wouldAdd"][number]>();
  const rejected: Record<string, number> = {};
  for (const report of reports) {
    for (const story of report.wouldAdd) {
      const key = urlKey(story.url);
      if (!stories.has(key)) stories.set(key, story);
    }
    for (const [reason, count] of Object.entries(report.counts)) rejected[reason] = (rejected[reason] ?? 0) + count;
  }
  const unique = [...stories.values()];
  return {
    editions: reports.length,
    uniqueStories: unique.length,
    perEdition: reports.map((report, index) => ({
      editionId: report.editionId ?? `sem-id-${index}`,
      model: report.model,
      searches: report.searches,
      candidates: report.candidates,
      wouldAdd: report.wouldAdd.length,
      errors: report.errors.length,
    })),
    rejected,
    bySearchRegion: tally(unique.map((story) => story.searchRegion)),
    byLanguage: tally(unique.map((story) => story.language)),
    topOutlets: tally(unique.map((story) => story.outlet)).slice(0, 8),
    averagePerEdition: reports.length ? unique.length / reports.length : 0,
  };
}

const REASON_PT: Record<string, string> = {
  "ja-conhecida": "já conhecida (feeds ou edição anterior)",
  link: "link não abriu ou título divergente",
  "sem-data": "página sem data de publicação",
  "fora-da-janela": "publicada fora da janela",
  "fora-do-tema": "fora do tema (não é sobre IA)",
};

function list(entries: ReadonlyArray<[string, number]>): string {
  return entries.length ? entries.map(([name, count]) => `${name} ${count}`).join(", ") : "nenhuma";
}

/** The summary as plain text for the terminal. */
export function renderShadowSummary(summary: ShadowSummary, options: { days: number; model?: string }): string {
  const lines: string[] = [];
  lines.push(
    `Busca sombra: últimos ${options.days} dias${options.model ? `, só ${options.model}` : ""}`,
    `${summary.editions} edições com busca, ${summary.uniqueStories} matérias novas que passaram em tudo (${summary.averagePerEdition.toFixed(1).replace(".", ",")} por edição)`,
    ""
  );
  if (summary.perEdition.length) {
    lines.push("Por edição");
    for (const edition of summary.perEdition) {
      lines.push(
        `  ${edition.editionId}  ${edition.model}  ${edition.searches} buscas, ${edition.candidates} candidatas, ` +
          `${edition.wouldAdd} passaram${edition.errors ? `, ${edition.errors} erro(s)` : ""}`
      );
    }
    lines.push("");
  }
  lines.push("Descartadas, somando as edições");
  for (const [reason, label] of Object.entries(REASON_PT)) lines.push(`  ${summary.rejected[reason] ?? 0}  ${label}`);
  lines.push(
    "",
    `Região da busca: ${list(summary.bySearchRegion)}`,
    `Idioma: ${list(summary.byLanguage)}`,
    `Veículos que mais aparecem: ${list(summary.topOutlets)}`,
    "",
    "O custo da busca fica em `npm run health` (etapas search e search-filter)."
  );
  return lines.join("\n");
}
