import { TIMEZONE } from "../edition/schema.js";
import { editionOutcome, summarizeCost, type CostSummary, type CostTotals, type EditionOutcome } from "./aggregate.js";
import type { CloudflareData, CronSlot } from "./cloudflare.js";
import type { GithubData, GithubRun } from "./github.js";
import type { HealthchecksData } from "./healthchecks.js";
import type { Source } from "./source.js";

/**
 * The panel as one static HTML file: no script, no request out (the CSP forbids both), every
 * value escaped. It is opened from disk, and nothing in it can change anything anywhere.
 */

export interface HealthSnapshot {
  generatedAt: string;
  since: string;
  days: number;
  github: Source<GithubData>;
  healthchecks: Source<HealthchecksData>;
  cloudflare: Source<CloudflareData>;
}

export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

const DASH = "—";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const e = escapeHtml;
type Tone = "ok" | "warn" | "bad" | "muted" | "";

function tag(text: string, tone: Tone, title?: string): string {
  const attrs = `${tone ? ` class="${tone}"` : ""}${title ? ` title="${e(title)}"` : ""}`;
  return attrs ? `<span${attrs}>${e(text)}</span>` : e(text);
}

// ---------------------------------------------------------------------------------------------
// Formatting

const usdSmall = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const usdLarge = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("pt-BR");
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const fullDateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: TIMEZONE, dateStyle: "short", timeStyle: "short" });
const clock = new Intl.DateTimeFormat("pt-BR", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" });
const weekday = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
const monthName = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" });

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return (Math.abs(value) < 1 ? usdSmall : usdLarge).format(value);
}

function formatInt(value: number | null | undefined): string {
  return value === null || value === undefined ? DASH : integer.format(value);
}

function formatWhen(iso: string | null | undefined, format = dateTime): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return DASH;
  return format.format(new Date(iso));
}

/** A Brasília calendar date (YYYY-MM-DD) as "sex., 24/10". */
function formatDay(date: string): string {
  return weekday.format(new Date(`${date}T12:00:00Z`));
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return DASH;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min ${seconds % 60} s` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

// ---------------------------------------------------------------------------------------------
// Labels

const EVENT_LABEL: Record<string, string> = {
  schedule: "cron de reserva",
  workflow_dispatch: "disparo",
  push: "push na main",
};

const OUTCOME_LABEL: Record<EditionOutcome, [string, Tone]> = {
  published: ["publicada", "ok"],
  partial: ["publicada com falhas", "warn"],
  already: ["já tinha saído", "muted"],
  unchanged: ["sem novidade", "muted"],
  failed: ["falhou", "bad"],
};

function runResult(run: GithubRun): string {
  if (run.status !== "completed") return tag(run.status === "in_progress" ? "rodando" : "na fila", "warn");
  switch (run.conclusion) {
    case "success":
      return tag("ok", "ok");
    case "failure":
      return tag("falhou", "bad");
    case "cancelled":
      return tag("cancelada", "warn");
    case "timed_out":
      return tag("estourou o tempo", "bad");
    case "skipped":
      return tag("pulada", "muted");
    default:
      return e(run.conclusion ?? DASH);
  }
}

function kitchenSummary(run: GithubRun): string {
  const report = run.reports.at(-1);
  if (!report) return run.unreadableReports > 0 ? tag("relatório ilegível", "warn") : DASH;
  const parts: string[] = [];
  const edition = report.jobs.find((job) => job.kind === "edition");
  const outcome = edition ? editionOutcome(edition) : null;
  if (outcome) parts.push(tag(...OUTCOME_LABEL[outcome]));
  if (report.catalogue === "captured") parts.push(tag("catálogo capturado", "ok"));
  if (report.catalogue === "failed") parts.push(tag("catálogo falhou", "bad"));
  if (report.outcome === "failed") parts.push(tag("cozinha falhou", "bad"));
  return parts.length > 0 ? parts.join(", ") : DASH;
}

const MONITOR_STATUS: Record<string, [string, Tone]> = {
  up: ["no ar", "ok"],
  grace: ["atrasado", "warn"],
  down: ["fora", "bad"],
  paused: ["pausado", "warn"],
  new: ["sem ping ainda", "muted"],
};

const SLOT_LABEL: Record<CronSlot["state"], [string, Tone, string]> = {
  ok: ["ok", "ok", "disparou e o GitHub aceitou"],
  failed: ["falhou", "bad", "o pedido ao GitHub falhou nas três tentativas"],
  missing: ["faltou", "bad", "a Cloudflare não disparou o cron"],
  before: [DASH, "muted", "antes do primeiro disparo deste horário na janela"],
};

// ---------------------------------------------------------------------------------------------
// Building blocks

function notice(source: Source<unknown>, what: string): string {
  if (source.state === "missing") {
    const names = source.missing.map((name) => `<code>${e(name)}</code>`).join(", ");
    return `<p class="aviso">Não configurado. Para ver ${e(what)}, preencha ${names} em <code>.env.health</code> (modelo em <code>.env.health.example</code>).</p>`;
  }
  if (source.state === "error") {
    return `<p class="aviso"><span class="bad">Não deu para ler ${e(what)}:</span> ${e(source.message)}</p>`;
  }
  return "";
}

function table(caption: string, head: string[], rows: string[][], numeric: number[] = []): string {
  if (rows.length === 0) return "";
  const cls = (index: number) => (numeric.includes(index) ? ' class="num"' : "");
  return [
    "<table>",
    `<caption>${e(caption)}</caption>`,
    `<thead><tr>${head.map((cell, index) => `<th scope="col"${cls(index)}>${e(cell)}</th>`).join("")}</tr></thead>`,
    "<tbody>",
    ...rows.map(
      (row) =>
        `<tr>${row.map((cell, index) => (index === 0 ? `<th scope="row">${cell}</th>` : `<td${cls(index)}>${cell}</td>`)).join("")}</tr>`
    ),
    "</tbody>",
    "</table>",
  ].join("\n");
}

function section(id: string, title: string, body: string): string {
  return `<section aria-labelledby="${id}">\n<h2 id="${id}">${e(title)}</h2>\n${body}\n</section>`;
}

function githubLink(url: string, label: string): string {
  // Only GitHub's own pages are ever linked; anything else stays text.
  return url.startsWith("https://github.com/") ? `<a href="${e(url)}">${e(label)}</a>` : e(label);
}

// ---------------------------------------------------------------------------------------------
// Sections

function summarySection(snapshot: HealthSnapshot, cost: CostSummary | null): string {
  const items: Array<[string, string]> = [];
  const month = cost ? monthName.format(new Date(`${cost.month}-15T12:00:00Z`)) : "do mês";

  items.push([`Gasto nos últimos ${snapshot.days} dias`, e(formatUsd(cost?.windowUsd))]);
  items.push([`Gasto em ${month}`, e(formatUsd(cost?.monthUsd))]);
  items.push(["Edições publicadas", e(cost && cost.reports > 0 ? formatInt(cost.publishedEditions) : DASH)]);
  items.push(["Custo por edição publicada", e(formatUsd(cost?.perEditionUsd))]);
  if (cost?.priciest) {
    const { usd, budgetUsd, run } = cost.priciest;
    const share = budgetUsd > 0 ? ` (${percent.format(usd / budgetUsd)} do teto de ${formatUsd(budgetUsd)})` : "";
    items.push(["Corrida mais cara", `${githubLink(run.url, formatUsd(usd))}${e(share)}`]);
  } else {
    items.push(["Corrida mais cara", DASH]);
  }
  items.push([
    "Corridas que falharam",
    cost ? tag(`${formatInt(cost.failedRuns)} de ${formatInt(cost.runs)}`, cost.failedRuns > 0 ? "bad" : "ok") : DASH,
  ]);

  if (snapshot.healthchecks.state === "ok") {
    const counts = new Map<string, number>();
    for (const check of snapshot.healthchecks.data.checks) counts.set(check.status, (counts.get(check.status) ?? 0) + 1);
    const text = [...counts]
      .map(([status, count]) => {
        const [label, tone] = MONITOR_STATUS[status] ?? [status, ""];
        return tag(`${count} ${label}`, tone);
      })
      .join(", ");
    items.push(["Monitores", text || DASH]);
  } else {
    items.push(["Monitores", DASH]);
  }

  if (snapshot.cloudflare.state === "ok") {
    const slots = snapshot.cloudflare.data.slots;
    const count = (state: CronSlot["state"]) => slots.filter((slot) => slot.state === state).length;
    const bad = count("failed") + count("missing");
    items.push([
      "Disparos do Worker",
      tag(`${count("ok")} ok, ${count("failed")} com falha, ${count("missing")} sem disparo`, bad > 0 ? "bad" : "ok"),
    ]);
  } else {
    items.push(["Disparos do Worker", DASH]);
  }

  const list = items.map(([term, value]) => `<div><dt>${e(term)}</dt><dd>${value}</dd></div>`).join("\n");
  return section("resumo", "Resumo", `<dl class="resumo">\n${list}\n</dl>`);
}

function totalsRows(rows: CostTotals[], withSearch: boolean): string[][] {
  return rows.map((row) => [
    e(row.key) + (row.priced ? "" : ` ${tag("sem preço", "warn", "modelo fora de MODEL_PRICES: custo subestimado")}`),
    e(formatInt(row.calls)),
    e(formatInt(row.inputTokens)),
    e(formatInt(row.outputTokens)),
    ...(withSearch ? [e(formatInt(row.webSearchCalls))] : []),
    e(formatUsd(row.usd)),
  ]);
}

function costSection(snapshot: HealthSnapshot, cost: CostSummary | null): string {
  if (snapshot.github.state !== "ok" || !cost) return section("custo", "Custo da OpenAI", notice(snapshot.github, "o custo"));
  if (cost.reports === 0) {
    return section(
      "custo",
      "Custo da OpenAI",
      "<p>Nenhuma corrida da janela tem relatório de custo ainda. Ele sai de cada corrida da cozinha a partir da versão do <code>publicar.yml</code> que grava o artefato <code>run-report-N.json</code>.</p>"
    );
  }
  const notes = [
    "<p class=\"nota\">Estimativa: tokens de cada etapa vezes a tabela de preços de <code>backend/src/edition/cost.ts</code>, mais US$ 0,01 por busca na web. Tokens em cache não têm o desconto aqui, então o valor tende a ficar um pouco acima do cobrado.</p>",
  ];
  if (cost.unpricedModels.length > 0) {
    notes.push(
      `<p class="aviso"><span class="warn">Modelos sem preço na tabela, contados só pelas buscas:</span> ${cost.unpricedModels.map((model) => `<code>${e(model)}</code>`).join(", ")}.</p>`
    );
  }
  return section(
    "custo",
    "Custo da OpenAI",
    [
      ...notes,
      table("Por etapa", ["Etapa", "Chamadas", "Tokens de entrada", "Tokens de saída", "Buscas", "Custo"], totalsRows(cost.bySteps, true), [1, 2, 3, 4, 5]),
      table("Por modelo", ["Modelo", "Chamadas", "Tokens de entrada", "Tokens de saída", "Custo"], totalsRows(cost.byModels, false), [1, 2, 3, 4]),
    ].join("\n")
  );
}

function daysSection(cost: CostSummary | null): string {
  if (!cost) return "";
  const rows = cost.days.map((day) => [
    e(formatDay(day.date)),
    day.runs === 0 ? tag("0", "bad", "nenhuma corrida neste dia") : e(formatInt(day.runs)),
    day.edition ? tag(...OUTCOME_LABEL[day.edition]) : DASH,
    e(formatUsd(day.usd)),
  ]);
  if (rows.length === 0) return "";
  return section(
    "dias",
    "Dia a dia",
    `${table("Desde a primeira corrida da janela, em Brasília", ["Dia", "Corridas", "Edição", "Custo"], rows, [1, 3])}\n<p class="nota">“—” quer dizer sem relatório naquele dia, não gasto zero.</p>`
  );
}

function runsSection(snapshot: HealthSnapshot, cost: CostSummary | null): string {
  if (snapshot.github.state !== "ok") return section("corridas", "Corridas", notice(snapshot.github, "as corridas do GitHub Actions"));
  const { runs, repo, workflow } = snapshot.github.data;
  if (runs.length === 0) return section("corridas", "Corridas", `<p>Nenhuma corrida de <code>${e(workflow)}</code> nos últimos ${snapshot.days} dias.</p>`);
  const rows = runs.map((run) => {
    const duration =
      run.status === "completed" && run.startedAt ? formatDuration(Date.parse(run.updatedAt) - Date.parse(run.startedAt)) : DASH;
    const usd = run.reports.length > 0 ? run.reports.reduce((sum, report) => sum + report.cost.totalUsd, 0) : null;
    return [
      githubLink(run.url, formatWhen(run.createdAt)),
      e(EVENT_LABEL[run.event] ?? run.event) + (run.attempt > 1 ? ` ${tag(`tentativa ${run.attempt}`, "muted")}` : ""),
      runResult(run),
      e(duration),
      kitchenSummary(run),
      e(formatUsd(usd)),
    ];
  });
  const missing =
    cost && cost.runsWithoutReport > 0
      ? `<p class="nota">${formatInt(cost.runsWithoutReport)} corrida(s) concluída(s) sem relatório: anteriores a ele, ou sem cozinha (push na main, pedido de “site”).</p>`
      : "";
  return section(
    "corridas",
    "Corridas",
    `${table(`${workflow} em ${repo}, da mais nova à mais antiga (horário de Brasília)`, ["Quando", "Origem", "Resultado", "Duração", "Cozinha", "Custo"], rows, [3, 5])}\n${missing}\n<p class="nota">“Disparo” inclui o Worker e os pedidos manuais. O resultado é o da corrida inteira: cozinha, site, deploy e conferência do site no ar.</p>`
  );
}

function monitorsSection(snapshot: HealthSnapshot): string {
  if (snapshot.healthchecks.state !== "ok") return section("monitores", "Monitores (Healthchecks.io)", notice(snapshot.healthchecks, "os monitores"));
  const { checks } = snapshot.healthchecks.data;
  if (checks.length === 0) return section("monitores", "Monitores (Healthchecks.io)", "<p>O projeto não tem nenhum monitor.</p>");
  const rows = checks.map((check) => {
    const [label, tone] = MONITOR_STATUS[check.status] ?? [check.status, ""];
    return [
      e(check.name),
      tag(label, tone),
      e(formatWhen(check.lastPing)),
      e(formatWhen(check.nextPing)),
      e(formatDuration(check.graceSeconds * 1000)),
      e(check.schedule ?? DASH),
    ];
  });
  return section(
    "monitores",
    "Monitores (Healthchecks.io)",
    table("Estado agora (horário de Brasília)", ["Monitor", "Estado", "Último ping", "Próximo esperado", "Carência", "Agenda"], rows)
  );
}

function cronClock(cron: string): string {
  const match = /^(\d{1,2})\s+(\d{1,2})\s/.exec(cron.trim());
  if (!match) return cron;
  return clock.format(new Date(Date.UTC(2026, 0, 1, Number(match[2]), Number(match[1]))));
}

function workerSection(snapshot: HealthSnapshot): string {
  const title = "Disparador (Worker da Cloudflare)";
  if (snapshot.cloudflare.state !== "ok") return section("disparador", title, notice(snapshot.cloudflare, "os disparos do Worker"));
  const { slots, unmatched, worker, limit, from } = snapshot.cloudflare.data;
  const limitNote = limit
    ? `<p class="nota">A Cloudflare só devolveu os disparos a partir de ${e(formatWhen(from))}; o plano não guarda os mais antigos.</p>`
    : "";
  if (slots.length === 0) {
    return section("disparador", title, `<p>Nenhum horário diário do <code>${e(worker)}</code> caiu na janela.</p>`);
  }
  const crons = [...new Set(slots.map((slot) => slot.cron))].sort((a, b) => cronClock(a).localeCompare(cronClock(b)));
  const byDay = new Map<string, Map<string, CronSlot>>();
  for (const slot of slots) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date(slot.scheduledAt));
    const row = byDay.get(day) ?? new Map<string, CronSlot>();
    row.set(slot.cron, slot);
    byDay.set(day, row);
  }
  const rows = [...byDay.keys()]
    .sort()
    .reverse()
    // Days from before the Worker existed say nothing; leave them out rather than fill rows with dashes.
    .filter((day) => [...(byDay.get(day)?.values() ?? [])].some((slot) => slot.state !== "before"))
    .map((day) => [
      e(formatDay(day)),
      ...crons.map((cron) => {
        const slot = byDay.get(day)?.get(cron);
        if (!slot) return DASH;
        const [label, tone, why] = SLOT_LABEL[slot.state];
        return tag(label, tone, slot.status && slot.state === "failed" ? `${why} (${slot.status})` : why);
      }),
    ]);
  const extra =
    unmatched.length > 0
      ? `<p class="nota">Mais ${formatInt(unmatched.length)} invocação(ões) fora dos horários do <code>wrangler.jsonc</code> (disparo manual pelo painel da Cloudflare, ou um cron antigo).</p>`
      : "";
  return section(
    "disparador",
    title,
    `${table(`${worker}: cada horário do cron, em Brasília`, ["Dia", ...crons.map(cronClock)], rows)}\n${extra}\n${limitNote}\n<p class="nota">“Faltou”: a Cloudflare não disparou o cron. “Falhou”: o pedido ao GitHub falhou nas três tentativas. Um horário só conta depois de 15 minutos.</p>`
  );
}

const CSS = `
:root { color-scheme: light dark; --fg: #1f2328; --muted: #59636e; --line: #d1d9e0; --bg: #ffffff; --soft: #f6f8fa;
  --ok: #1a7f37; --warn: #9a6700; --bad: #b42318; }
@media (prefers-color-scheme: dark) { :root { --fg: #e6edf3; --muted: #9198a1; --line: #3d444d; --bg: #0d1117; --soft: #151b23;
  --ok: #4ac26b; --warn: #d29922; --bad: #ff7b72; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 72rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
h2 { font-size: 1.15rem; margin: 2.5rem 0 .75rem; padding-bottom: .35rem; border-bottom: 1px solid var(--line); }
header p, .nota { color: var(--muted); }
.nota { font-size: .9rem; }
.aviso { background: var(--soft); border: 1px solid var(--line); border-radius: 6px; padding: .6rem .8rem; }
.resumo { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: .75rem; margin: 0; }
.resumo div { background: var(--soft); border: 1px solid var(--line); border-radius: 6px; padding: .7rem .9rem; }
.resumo dt { color: var(--muted); font-size: .85rem; }
.resumo dd { margin: .15rem 0 0; font-size: 1.1rem; font-weight: 600; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-variant-numeric: tabular-nums; }
caption { text-align: left; font-weight: 600; padding-bottom: .4rem; }
th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
thead th { color: var(--muted); font-weight: 600; font-size: .85rem; }
tbody th { font-weight: 400; white-space: nowrap; }
.num { text-align: right; white-space: nowrap; }
code { font-size: .9em; background: var(--soft); padding: .05rem .3rem; border-radius: 4px; }
a { color: inherit; }
.ok { color: var(--ok); } .warn { color: var(--warn); } .bad { color: var(--bad); font-weight: 600; } .muted { color: var(--muted); }
`;

export function renderHealthPage(snapshot: HealthSnapshot): string {
  const cost =
    snapshot.github.state === "ok"
      ? summarizeCost(snapshot.github.data.runs, { since: new Date(snapshot.since), now: new Date(snapshot.generatedAt) })
      : null;
  const repo = snapshot.github.state === "ok" ? ` · ${e(snapshot.github.data.repo)}` : "";

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">
<meta name="referrer" content="no-referrer">
<title>Painel do Pulso</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header>
<h1>Painel do Pulso</h1>
<p>Gerado em ${e(formatWhen(snapshot.generatedAt, fullDateTime))}, horário de Brasília · últimos ${snapshot.days} dias${repo}. Para atualizar, rode <code>npm run health</code> de novo.</p>
</header>
${summarySection(snapshot, cost)}
${costSection(snapshot, cost)}
${daysSection(cost)}
${runsSection(snapshot, cost)}
${monitorsSection(snapshot)}
${workerSection(snapshot)}
</main>
</body>
</html>
`;
}
