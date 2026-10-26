import { calendarDateBrt, hourBrt } from "../edition/timezone.js";
import type { RunReport, RunReportJob } from "../kitchen/runReport.js";
import { editionOutcome, type EditionOutcome } from "./aggregate.js";
import type { CloudflareData } from "./cloudflare.js";
import type { GithubRun } from "./github.js";
import type { HealthchecksData } from "./healthchecks.js";
import type { Source } from "./source.js";

/**
 * The answer to "is everything fine today?", and one cell per day for the status strips. Built
 * only from what the sources returned; a day nobody reported on stays unknown, never green.
 */

export type Level = "ok" | "warn" | "bad" | "idle" | "none";

export interface Verdict {
  level: "ok" | "warn" | "bad" | "pending" | "unknown";
  headline: string;
  /** Short facts under the headline: time, items, cost. */
  facts: string[];
  /** Everything that needs a look, worst first. */
  issues: Array<{ level: "warn" | "bad"; text: string }>;
}

export interface DayCell {
  date: string;
  level: Level;
  label: string;
}

export interface StatusLanes {
  edition: DayCell[];
  runs: DayCell[];
  worker: DayCell[] | null;
}

/** The edition is due at 07:30 BRT; before this hour an empty day is not late yet. */
const EDITION_DUE_HOUR = 8;

const brt = (iso: string) => calendarDateBrt(new Date(iso));

function nextDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function datesBetween(first: string, last: string): string[] {
  const dates: string[] = [];
  for (let date = first; date <= last; date = nextDate(date)) dates.push(date);
  return dates;
}

interface ReportJob {
  report: RunReport;
  job: RunReportJob;
}

function editionJobs(runs: GithubRun[], date: string): ReportJob[] {
  return runs
    .flatMap((run) => run.reports)
    .filter((report) => brt(report.startedAt) === date)
    .flatMap((report) => report.jobs.filter((job) => job.kind === "edition").map((job) => ({ report, job })));
}

const RANK: EditionOutcome[] = ["published", "partial", "already", "unchanged", "failed"];

function best(jobs: ReportJob[]): ReportJob | null {
  let pick: ReportJob | null = null;
  for (const entry of jobs) {
    const outcome = editionOutcome(entry.job);
    if (!outcome) continue;
    if (!pick || RANK.indexOf(outcome) < RANK.indexOf(editionOutcome(pick.job)!)) pick = entry;
  }
  return pick;
}

const EDITION_CELL: Record<EditionOutcome, [Level, string]> = {
  published: ["ok", "edição publicada"],
  partial: ["warn", "publicada com falhas em fontes ou etapas"],
  already: ["ok", "edição já tinha saído"],
  unchanged: ["idle", "sem novidade para publicar"],
  failed: ["bad", "a edição falhou"],
};

export function statusLanes(input: {
  runs: GithubRun[];
  cloudflare: Source<CloudflareData>;
  since: Date;
  now: Date;
}): StatusLanes {
  const today = calendarDateBrt(input.now);
  const runDates = input.runs.map((run) => brt(run.createdAt)).sort();
  const first = runDates[0] && runDates[0] > calendarDateBrt(input.since) ? runDates[0] : calendarDateBrt(input.since);
  const dates = runDates.length > 0 ? datesBetween(first, today) : [];

  const edition = dates.map((date): DayCell => {
    const pick = best(editionJobs(input.runs, date));
    if (pick) {
      const [level, label] = EDITION_CELL[editionOutcome(pick.job)!];
      return { date, level, label };
    }
    return { date, level: "none", label: "sem relatório da cozinha" };
  });

  const runs = dates.map((date): DayCell => {
    const day = input.runs.filter((run) => brt(run.createdAt) === date && run.status === "completed");
    const failed = day.filter((run) => run.conclusion === "failure" || run.conclusion === "timed_out").length;
    if (day.length === 0) return { date, level: date === today ? "none" : "bad", label: "nenhuma corrida" };
    return failed > 0
      ? { date, level: "warn", label: `${failed} de ${day.length} corridas falharam` }
      : { date, level: "ok", label: `${day.length} corrida(s), todas ok` };
  });

  let worker: DayCell[] | null = null;
  if (input.cloudflare.state === "ok") {
    const slots = input.cloudflare.data.slots;
    worker = dates.map((date): DayCell => {
      const day = slots.filter((slot) => brt(slot.scheduledAt) === date && slot.state !== "before");
      if (day.length === 0) return { date, level: "none", label: "sem horário do Worker" };
      const bad = day.filter((slot) => slot.state === "failed" || slot.state === "missing").length;
      return bad > 0
        ? { date, level: "bad", label: `${bad} de ${day.length} disparos falharam ou faltaram` }
        : { date, level: "ok", label: `${day.length} disparo(s) ok` };
    });
  }
  return { edition, runs, worker };
}

const usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clock = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

export function verdict(input: {
  runs: GithubRun[] | null;
  healthchecks: Source<HealthchecksData>;
  cloudflare: Source<CloudflareData>;
  now: Date;
}): Verdict {
  const today = calendarDateBrt(input.now);
  const issues: Verdict["issues"] = [];
  const facts: string[] = [];

  if (input.healthchecks.state === "ok") {
    for (const check of input.healthchecks.data.checks) {
      if (check.status === "down") issues.push({ level: "bad", text: `Monitor “${check.name}” fora: o Healthchecks não recebeu o ping no prazo.` });
      if (check.status === "grace") issues.push({ level: "warn", text: `Monitor “${check.name}” atrasado: o ping esperado ainda não chegou.` });
      if (check.status === "paused") issues.push({ level: "warn", text: `Monitor “${check.name}” pausado: ele não vai avisar se algo quebrar.` });
    }
  }
  if (input.cloudflare.state === "ok") {
    const today_ = input.cloudflare.data.slots.filter((slot) => brt(slot.scheduledAt) === today);
    const failed = today_.filter((slot) => slot.state === "failed").length;
    const missing = today_.filter((slot) => slot.state === "missing").length;
    if (failed > 0) issues.push({ level: "warn", text: `${failed} disparo(s) do Worker hoje não conseguiram pedir a corrida ao GitHub.` });
    if (missing > 0) issues.push({ level: "warn", text: `${missing} horário(s) do Worker hoje sem disparo da Cloudflare.` });
  }
  for (const [name, source] of [["GitHub", { state: input.runs ? "ok" : "error" }], ["Healthchecks.io", input.healthchecks], ["Cloudflare", input.cloudflare]] as const) {
    if (source.state === "error") issues.push({ level: "warn", text: `Não deu para ler ${name}; o veredito vale só para o resto.` });
  }

  if (!input.runs) {
    return { level: "unknown", headline: "Sem dados do GitHub para dizer como está a edição de hoje.", facts, issues };
  }

  const todayRuns = input.runs.filter((run) => brt(run.createdAt) === today && run.status === "completed");
  const failedRuns = todayRuns.filter((run) => run.conclusion === "failure" || run.conclusion === "timed_out").length;
  const pick = best(editionJobs(input.runs, today));
  const outcome = pick ? editionOutcome(pick.job) : null;

  if (pick && (outcome === "published" || outcome === "partial")) {
    facts.push(`publicada às ${clock.format(new Date(pick.report.finishedAt))}`);
    const quality = pick.job.quality;
    if (quality) facts.push(quality.kind === "quiet" ? "edição sem novidade verificada" : `${quality.items} itens`);
    facts.push(`${usd.format(pick.job.costUsd)} na OpenAI`);
    if (quality && quality.feedsFailed > 0) issues.push({ level: "warn", text: `${quality.feedsFailed} feed(s) falharam na corrida de hoje.` });
    if (quality?.headlineFellBack) issues.push({ level: "warn", text: "A manchete de hoje caiu para os títulos das fontes: o texto gerado não passou na checagem." });
    if (quality?.kind === "quiet") issues.push({ level: "warn", text: "Hoje saiu uma edição vazia: nada novo passou na verificação." });
    if (pick.job.costUsd >= pick.report.cost.budgetUsd * 0.75) {
      issues.push({ level: "warn", text: `A corrida de hoje usou ${Math.round((pick.job.costUsd / pick.report.cost.budgetUsd) * 100)}% do teto de ${usd.format(pick.report.cost.budgetUsd)}.` });
    }
  } else if (outcome === "already") {
    facts.push("publicada numa corrida anterior");
  }
  if (failedRuns > 0) issues.push({ level: "warn", text: `${failedRuns} de ${todayRuns.length} corridas de hoje falharam.` });

  issues.sort((a, b) => (a.level === b.level ? 0 : a.level === "bad" ? -1 : 1));
  const worst = issues[0]?.level;

  if (outcome === "published" || outcome === "partial" || outcome === "already") {
    return {
      level: worst ?? (outcome === "partial" ? "warn" : "ok"),
      headline: worst ? "A edição de hoje está no ar, com pontos a olhar." : "A edição de hoje está no ar.",
      facts,
      issues: outcome === "partial" && !issues.length ? [{ level: "warn", text: "A edição saiu com falha em alguma fonte ou etapa." }] : issues,
    };
  }
  if (outcome === "failed") {
    return { level: "bad", headline: "A edição de hoje falhou.", facts, issues };
  }
  if (hourBrt(input.now) < EDITION_DUE_HOUR) {
    return { level: worst === "bad" ? "bad" : "pending", headline: "A edição de hoje ainda não rodou; ela sai às 07:30.", facts, issues };
  }
  if (todayRuns.length > 0 && todayRuns.every((run) => run.reports.length === 0)) {
    return {
      level: worst ?? "unknown",
      headline: "Hoje houve corridas, mas nenhuma deixou relatório.",
      facts: [`${todayRuns.length} corrida(s), ${failedRuns} com falha`],
      issues,
    };
  }
  return { level: "bad", headline: "A edição de hoje não saiu.", facts, issues };
}
