import { calendarDateBrt } from "../edition/timezone.js";
import type { RunReport, RunReportJob } from "../kitchen/runReport.js";
import type { GithubRun } from "./github.js";

/**
 * Cost and edition figures from the run reports. A figure with no report behind it is `null`, and
 * the page shows it as "—": no report is not the same as zero spent.
 */

export interface CostTotals {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  webSearchCalls: number;
  usd: number;
  /** False when any call of this row used a model without a price. */
  priced: boolean;
}

export type EditionOutcome = "published" | "partial" | "already" | "unchanged" | "failed";

export interface DaySummary {
  /** Calendar date in Brasília. */
  date: string;
  runs: number;
  reports: number;
  edition: EditionOutcome | null;
  usd: number | null;
}

export interface CostSummary {
  runs: number;
  failedRuns: number;
  reports: number;
  /** Completed runs with no readable report: before the report existed, or no kitchen job. */
  runsWithoutReport: number;
  windowUsd: number | null;
  /** Current month in Brasília; null when the window does not reach back to its first day. */
  month: string;
  monthUsd: number | null;
  publishedEditions: number;
  /** Everything spent in the window, failed and empty runs included, per edition published. */
  perEditionUsd: number | null;
  priciest: { run: GithubRun; usd: number; budgetUsd: number } | null;
  bySteps: CostTotals[];
  byModels: CostTotals[];
  unpricedModels: string[];
  days: DaySummary[];
}

const round = (value: number) => Number(value.toFixed(6));

function nextDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/** What a kitchen job means for the day's edition; null when it says nothing about it. */
export function editionOutcome(job: RunReportJob): EditionOutcome | null {
  if (job.kind !== "edition") return null;
  if (job.status === "published") return "published";
  if (job.status === "partial") return "partial";
  if (job.skippedReason === "slot-already-published") return "already";
  if (job.status === "unchanged") return "unchanged";
  return "failed";
}

// Best news first: one run that published makes the day published, whatever the others did.
const OUTCOME_RANK: EditionOutcome[] = ["published", "partial", "already", "unchanged", "failed"];

function bestOutcome(outcomes: Array<EditionOutcome | null>): EditionOutcome | null {
  let best: EditionOutcome | null = null;
  for (const outcome of outcomes) {
    if (outcome && (best === null || OUTCOME_RANK.indexOf(outcome) < OUTCOME_RANK.indexOf(best))) best = outcome;
  }
  return best;
}

function totalsBy(reports: RunReport[], key: (entry: RunReport["cost"]["entries"][number]) => string): CostTotals[] {
  const rows = new Map<string, CostTotals>();
  for (const entry of reports.flatMap((report) => report.cost.entries)) {
    const id = key(entry);
    const row = rows.get(id) ?? {
      key: id,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      webSearchCalls: 0,
      usd: 0,
      priced: true,
    };
    row.calls += 1;
    row.inputTokens += entry.inputTokens;
    row.outputTokens += entry.outputTokens;
    row.webSearchCalls += entry.webSearchCalls;
    row.usd = round(row.usd + entry.usd);
    row.priced &&= entry.priced;
    rows.set(id, row);
  }
  return [...rows.values()].sort((a, b) => b.usd - a.usd || a.key.localeCompare(b.key));
}

const reportCost = (reports: RunReport[]) => round(reports.reduce((sum, report) => sum + report.cost.totalUsd, 0));

export function summarizeCost(runs: GithubRun[], window: { since: Date; now: Date }): CostSummary {
  const reports = runs.flatMap((run) => run.reports);
  const hasReports = reports.length > 0;
  const today = calendarDateBrt(window.now);
  const month = today.slice(0, 7);
  const firstDay = calendarDateBrt(window.since);

  const editionIds = new Set(
    reports
      .flatMap((report) => report.jobs)
      .filter((job) => (job.status === "published" || job.status === "partial") && job.kind === "edition" && job.editionId)
      .map((job) => job.editionId)
  );
  const windowUsd = hasReports ? reportCost(reports) : null;

  let priciest: CostSummary["priciest"] = null;
  for (const run of runs) {
    if (run.reports.length === 0) continue;
    const usd = reportCost(run.reports);
    if (!priciest || usd > priciest.usd) {
      priciest = { run, usd, budgetUsd: run.reports.at(-1)?.cost.budgetUsd ?? 0 };
    }
  }

  // From the first run in the window: days before it predate the workflow (or the window's first
  // run), and listing them as empty would read as an outage. A day without runs after it is one.
  const runDates = runs.map((run) => calendarDateBrt(new Date(run.createdAt))).sort();
  const firstRunDay = runDates[0];
  const days: DaySummary[] = [];
  const start = firstRunDay && firstRunDay > firstDay ? firstRunDay : firstDay;
  for (let date = start; firstRunDay && date <= today; date = nextDate(date)) {
    const dayReports = reports.filter((report) => calendarDateBrt(new Date(report.startedAt)) === date);
    days.push({
      date,
      runs: runs.filter((run) => calendarDateBrt(new Date(run.createdAt)) === date).length,
      reports: dayReports.length,
      edition: bestOutcome(dayReports.flatMap((report) => report.jobs.map(editionOutcome))),
      usd: dayReports.length > 0 ? reportCost(dayReports) : null,
    });
  }
  days.reverse();

  const monthReports = reports.filter((report) => calendarDateBrt(new Date(report.startedAt)).startsWith(month));

  return {
    runs: runs.length,
    failedRuns: runs.filter((run) => run.conclusion === "failure").length,
    reports: reports.length,
    runsWithoutReport: runs.filter((run) => run.status === "completed" && run.reports.length === 0).length,
    windowUsd,
    month,
    monthUsd: hasReports && firstDay <= `${month}-01` ? reportCost(monthReports) : null,
    publishedEditions: editionIds.size,
    perEditionUsd: windowUsd !== null && editionIds.size > 0 ? round(windowUsd / editionIds.size) : null,
    priciest,
    bySteps: totalsBy(reports, (entry) => entry.step),
    byModels: totalsBy(reports, (entry) => entry.model),
    unpricedModels: [...new Set(reports.flatMap((report) => report.cost.unpricedModels))].sort(),
    days,
  };
}
