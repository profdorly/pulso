import { TIMEZONE } from "../edition/schema.js";
import type { RunReportJob } from "../kitchen/runReport.js";
import { editionOutcome, summarizeCost, type CostSummary, type CostTotals, type EditionOutcome } from "./aggregate.js";
import type { CloudflareData } from "./cloudflare.js";
import type { GithubData, GithubRun } from "./github.js";
import type { HealthchecksData } from "./healthchecks.js";
import type { Source } from "./source.js";
import { statusLanes, verdict, type DayCell, type Level, type Verdict } from "./status.js";

/**
 * The panel as one static HTML file in the site's "Papel & Brasa" system (frontend/src/index.css):
 * no script, no request out (the CSP forbids both), every value escaped. Fonts, when given, are
 * inlined as data URIs, so the page looks the same opened straight from disk.
 */

export interface HealthSnapshot {
  generatedAt: string;
  since: string;
  days: number;
  github: Source<GithubData>;
  healthchecks: Source<HealthchecksData>;
  cloudflare: Source<CloudflareData>;
}

export const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'";

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

function pill(text: string, tone: Tone, title?: string): string {
  return `<span class="pill${tone ? ` pill--${tone}` : ""}"${title ? ` title="${e(title)}"` : ""}>${e(text)}</span>`;
}

// ---------------------------------------------------------------------------------------------
// Formatting

const usdSmall = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const usdLarge = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("pt-BR");
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: TIMEZONE, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fullDateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: TIMEZONE, dateStyle: "short", timeStyle: "short" });
const weekday = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
const shortDay = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" });
const monthName = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long" });

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  // Four decimals only where two would round a real cost to zero (a single Luna call).
  return (Math.abs(value) < 0.1 ? usdSmall : usdLarge).format(value);
}

const formatInt = (value: number | null | undefined) => (value === null || value === undefined ? DASH : integer.format(value));

function formatWhen(iso: string | null | undefined, format = dateTime): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return DASH;
  return format.format(new Date(iso));
}

const formatDay = (date: string, format = weekday) => format.format(new Date(`${date}T12:00:00Z`));

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return DASH;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min ${seconds % 60} s` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

// ---------------------------------------------------------------------------------------------
// Labels

const EVENT_LABEL: Record<string, string> = { schedule: "cron de reserva", workflow_dispatch: "disparo", push: "push na main" };

const STEP_LABEL: Record<string, string> = {
  search: "busca na web",
  "search-filter": "filtro da busca",
  worker: "classificação",
  summarize: "resumos",
  editorial: "editorial",
  humanize: "revisão de estilo",
  audit: "auditoria",
};

const NOTE_LABEL: Record<string, string> = {
  "pulso-audit": "auditoria",
  "pulso-cost": "custo",
  "pulso-worker": "classificação",
  "pulso-editorial": "editorial",
  "pulso-humanize": "revisão",
  "pulso-gate": "checagem",
};

const OUTCOME_LABEL: Record<EditionOutcome, [string, Tone]> = {
  published: ["publicada", "ok"],
  partial: ["publicada com falhas", "warn"],
  already: ["já tinha saído", "muted"],
  unchanged: ["sem novidade", "muted"],
  failed: ["falhou", "bad"],
};

const MONITOR_STATUS: Record<string, [string, Tone]> = {
  up: ["no ar", "ok"],
  grace: ["atrasado", "warn"],
  down: ["fora", "bad"],
  paused: ["pausado", "warn"],
  new: ["sem ping ainda", "muted"],
};

function runResult(run: GithubRun): string {
  if (run.status !== "completed") return pill(run.status === "in_progress" ? "rodando" : "na fila", "warn");
  switch (run.conclusion) {
    case "success":
      return pill("ok", "ok");
    case "failure":
      return pill("falhou", "bad");
    case "cancelled":
      return pill("cancelada", "warn");
    case "timed_out":
      return pill("estourou o tempo", "bad");
    case "skipped":
      return pill("pulada", "muted");
    default:
      return e(run.conclusion ?? DASH);
  }
}

function kitchenSummary(run: GithubRun): string {
  const report = run.reports.at(-1);
  if (!report) return run.unreadableReports > 0 ? pill("relatório ilegível", "warn") : `<span class="muted">${DASH}</span>`;
  const parts: string[] = [];
  const edition = report.jobs.find((job) => job.kind === "edition");
  const outcome = edition ? editionOutcome(edition) : null;
  if (outcome) parts.push(pill(...OUTCOME_LABEL[outcome]));
  if (report.catalogue === "captured") parts.push(pill("catálogo capturado", "ok"));
  if (report.catalogue === "failed") parts.push(pill("catálogo falhou", "bad"));
  if (report.outcome === "failed") parts.push(pill("cozinha falhou", "bad"));
  return parts.length > 0 ? parts.join(" ") : DASH;
}

// ---------------------------------------------------------------------------------------------
// Building blocks

function notice(source: Source<unknown>, what: string): string {
  if (source.state === "missing") {
    const names = source.missing.map((name) => `<code>${e(name)}</code>`).join(", ");
    return `<p class="aviso">Não configurado. Para ver ${e(what)}, preencha ${names} em <code>.env.health</code> (modelo em <code>.env.health.example</code>).</p>`;
  }
  if (source.state === "error") {
    return `<p class="aviso aviso--bad"><strong>Não deu para ler ${e(what)}.</strong> ${e(source.message)}</p>`;
  }
  return "";
}

function table(caption: string, head: string[], rows: string[][], numeric: number[] = []): string {
  if (rows.length === 0) return "";
  const cls = (index: number) => (numeric.includes(index) ? ' class="num"' : "");
  return [
    '<div class="tabela"><table>',
    `<caption>${e(caption)}</caption>`,
    `<thead><tr>${head.map((cell, index) => `<th scope="col"${cls(index)}>${e(cell)}</th>`).join("")}</tr></thead>`,
    "<tbody>",
    ...rows.map((row) => `<tr>${row.map((cell, index) => (index === 0 ? `<th scope="row">${cell}</th>` : `<td${cls(index)}>${cell}</td>`)).join("")}</tr>`),
    "</tbody>",
    "</table></div>",
  ].join("\n");
}

function section(id: string, kicker: string, title: string, body: string): string {
  return `<section class="bloco" aria-labelledby="${id}">\n<p class="kicker">${e(kicker)}</p>\n<h2 id="${id}" class="titulo-secao">${e(title)}</h2>\n${body}\n</section>`;
}

function githubLink(url: string, label: string): string {
  // Only GitHub's own pages are ever linked; anything else stays text.
  return url.startsWith("https://github.com/") ? `<a href="${e(url)}">${e(label)}</a>` : e(label);
}

// ---------------------------------------------------------------------------------------------
// Verdict and status strips

const VERDICT_MARK: Record<Verdict["level"], string> = { ok: "ok", warn: "atenção", bad: "falha", pending: "aguardando", unknown: "sem dado" };

function verdictBlock(v: Verdict, snapshot: HealthSnapshot, repo: string): string {
  const facts = v.facts.map((fact) => `<span>${e(fact)}</span>`).join("");
  const issues =
    v.issues.length > 0
      ? `<ul class="pendencias">${v.issues.map((issue) => `<li class="pendencia pendencia--${issue.level}"><span class="ponto" aria-hidden="true"></span>${e(issue.text)}</li>`).join("")}</ul>`
      : "";
  return `<header class="veredito veredito--${v.level}">
<p class="kicker">Painel do Pulso · últimos ${snapshot.days} dias${repo ? ` · ${e(repo)}` : ""}</p>
<div class="veredito-linha"><span class="selo" aria-hidden="true"></span><span class="sr">Estado: ${e(VERDICT_MARK[v.level])}.</span><h1 class="titulo">${e(v.headline)}</h1></div>
${facts ? `<p class="linha-fatos">${facts}</p>` : ""}
${issues}
<p class="nota">Gerado em ${e(formatWhen(snapshot.generatedAt, fullDateTime))}, horário de Brasília. Para atualizar, rode <code>npm run health</code> de novo.</p>
</header>`;
}

function strip(name: string, cells: DayCell[], summary: string): string {
  const boxes = cells
    .map((cell) => `<span class="dia dia--${cell.level}" title="${e(`${formatDay(cell.date)}: ${cell.label}`)}"></span>`)
    .join("");
  return `<div class="faixa">
<div class="faixa-topo"><span class="faixa-nome">${e(name)}</span><span class="faixa-resumo">${e(summary)}</span></div>
<div class="dias" role="img" aria-label="${e(`${name}: ${summary}`)}">${boxes}</div>
</div>`;
}

const countLevel = (cells: DayCell[], ...levels: Level[]) => cells.filter((cell) => levels.includes(cell.level)).length;

function statusSection(snapshot: HealthSnapshot, runs: GithubRun[] | null): string {
  const parts: string[] = [];
  if (runs) {
    const lanes = statusLanes({ runs, cloudflare: snapshot.cloudflare, since: new Date(snapshot.since), now: new Date(snapshot.generatedAt) });
    if (lanes.edition.length > 0) {
      const known = lanes.edition.length - countLevel(lanes.edition, "none");
      parts.push(
        strip(
          "Edição do dia",
          lanes.edition,
          known > 0 ? `${countLevel(lanes.edition, "ok", "warn")} de ${known} ${known === 1 ? "dia" : "dias"} com relatório ${known === 1 ? "publicou" : "publicaram"}` : "sem relatório ainda"
        )
      );
      parts.push(strip("Corridas do publicar.yml", lanes.runs, `${countLevel(lanes.runs, "warn", "bad")} dia(s) com falha`));
      if (lanes.worker) {
        const known = lanes.worker.length - countLevel(lanes.worker, "none");
        parts.push(strip("Disparador (Worker)", lanes.worker, known > 0 ? `${countLevel(lanes.worker, "bad")} dia(s) com disparo perdido` : "sem disparo na janela"));
      }
      const first = lanes.edition[0].date;
      parts.push(`<div class="eixo"><span>${e(formatDay(first, shortDay))}</span><span>hoje</span></div>`);
      parts.push(`<p class="legenda">${[
        ["ok", "ok"],
        ["warn", "com pontos a olhar"],
        ["bad", "falha"],
        ["idle", "sem novidade"],
        ["none", "sem dado"],
      ]
        .map(([level, label]) => `<span><span class="dia dia--${level}" aria-hidden="true"></span>${label}</span>`)
        .join("")}</p>`);
    }
  } else {
    parts.push(notice(snapshot.github, "as corridas do GitHub Actions"));
  }
  if (snapshot.cloudflare.state !== "ok") parts.push(notice(snapshot.cloudflare, "os disparos do Worker"));
  if (snapshot.cloudflare.state === "ok" && snapshot.cloudflare.data.limit) {
    parts.push(`<p class="nota">A Cloudflare só devolveu os disparos a partir de ${e(formatWhen(snapshot.cloudflare.data.from))}.</p>`);
  }

  if (snapshot.healthchecks.state === "ok") {
    const rows = snapshot.healthchecks.data.checks.map((check) => {
      const [label, tone] = MONITOR_STATUS[check.status] ?? [check.status, ""];
      return `<li class="monitor"><span class="monitor-nome">${e(check.name)}</span>${pill(label, tone)}<span class="monitor-meta">último ping ${e(formatWhen(check.lastPing))} · próximo ${e(formatWhen(check.nextPing))}</span></li>`;
    });
    parts.push(rows.length > 0 ? `<h3 class="subtitulo">Monitores do Healthchecks.io</h3><ul class="monitores">${rows.join("")}</ul>` : "<p>O projeto não tem nenhum monitor.</p>");
  } else {
    parts.push(notice(snapshot.healthchecks, "os monitores"));
  }

  return section("estado", "Estado", "Últimos dias", parts.join("\n"));
}

// ---------------------------------------------------------------------------------------------
// Cost

function stat(label: string, value: string, detail = ""): string {
  return `<div class="cartao"><p class="cartao-rotulo">${e(label)}</p><p class="cartao-valor">${value}</p>${detail ? `<p class="cartao-detalhe">${detail}</p>` : ""}</div>`;
}

function barsList(caption: string, rows: CostTotals[], label: (key: string) => string): string {
  if (rows.length === 0) return "";
  const max = Math.max(...rows.map((row) => row.usd), 0);
  const items = rows.map((row) => {
    const width = max > 0 ? Math.max(2, (row.usd / max) * 100) : 0;
    const flag = row.priced ? "" : ` ${pill("sem preço", "warn", "modelo fora de MODEL_PRICES: custo subestimado")}`;
    const tokens = `${compact.format(row.inputTokens)} entrada · ${compact.format(row.outputTokens)} saída${row.webSearchCalls ? ` · ${formatInt(row.webSearchCalls)} buscas` : ""}`;
    return `<li><div class="barra-topo"><span>${e(label(row.key))}${flag}</span><span class="num">${e(formatUsd(row.usd))}</span></div><div class="barra"><span style="width:${width.toFixed(1)}%"></span></div><p class="barra-detalhe">${e(tokens)} · ${formatInt(row.calls)} chamada(s)</p></li>`;
  });
  return `<div class="coluna"><h3 class="subtitulo">${e(caption)}</h3><ul class="barras">${items.join("")}</ul></div>`;
}

function dailyChart(cost: CostSummary): string {
  const days = [...cost.days].reverse();
  if (days.length === 0) return "";
  const max = Math.max(...days.map((day) => day.usd ?? 0), 0);
  const cols = days
    .map((day) => {
      const title = `${formatDay(day.date)}: ${day.usd === null ? "sem relatório" : formatUsd(day.usd)}`;
      if (day.usd === null) return `<span class="coluna-dia coluna-dia--vazia" title="${e(title)}"></span>`;
      const height = max > 0 ? Math.max(3, (day.usd / max) * 100) : 3;
      return `<span class="coluna-dia" title="${e(title)}"><span style="height:${height.toFixed(1)}%"></span></span>`;
    })
    .join("");
  return `<div class="grafico" role="img" aria-label="${e(`Custo por dia; o maior foi ${formatUsd(max)}`)}">
<div class="grafico-colunas">${cols}</div>
<div class="eixo"><span>${e(formatDay(days[0].date, shortDay))}</span><span>maior dia: ${e(formatUsd(max))}</span><span>hoje</span></div>
</div>`;
}

function costSection(snapshot: HealthSnapshot, cost: CostSummary | null): string {
  if (snapshot.github.state !== "ok" || !cost) return section("custo", "OpenAI", "Custo", notice(snapshot.github, "o custo"));
  const month = monthName.format(new Date(`${cost.month}-15T12:00:00Z`));
  const priciest = cost.priciest;
  const share = priciest && priciest.budgetUsd > 0 ? Math.min(100, (priciest.usd / priciest.budgetUsd) * 100) : 0;

  const cards = [
    stat(`Últimos ${snapshot.days} dias`, e(formatUsd(cost.windowUsd)), cost.reports > 0 ? `${formatInt(cost.reports)} corrida(s) com relatório` : "nenhuma corrida com relatório ainda"),
    stat(`Em ${month}`, e(formatUsd(cost.monthUsd)), cost.monthUsd === null && cost.reports > 0 ? "a janela não cobre o mês inteiro" : ""),
    stat("Por edição publicada", e(formatUsd(cost.perEditionUsd)), cost.publishedEditions > 0 ? `${formatInt(cost.publishedEditions)} edição(ões); inclui corridas que falharam` : ""),
    stat(
      "Corrida mais cara",
      priciest ? githubLink(priciest.run.url, formatUsd(priciest.usd)) : DASH,
      priciest
        ? `<span class="teto"><span style="width:${share.toFixed(1)}%"></span></span>${e(`${Math.round(share)}% do teto de ${formatUsd(priciest.budgetUsd)}`)}`
        : ""
    ),
  ].join("\n");

  const body = [`<div class="cartoes">${cards}</div>`];
  if (cost.reports === 0) {
    body.push(
      '<p class="nota">O custo sai do relatório que cada corrida da cozinha grava (<code>run-report-N.json</code>). Corridas anteriores a ele ficam sem custo; a partir da próxima edição, os números aparecem aqui.</p>'
    );
  } else {
    body.push(dailyChart(cost));
    body.push(`<div class="colunas">${barsList("Por etapa", cost.bySteps, (key) => STEP_LABEL[key] ?? key)}${barsList("Por modelo", cost.byModels, (key) => key)}</div>`);
    if (cost.unpricedModels.length > 0) {
      body.push(`<p class="aviso">Modelos sem preço na tabela, contados só pelas buscas: ${cost.unpricedModels.map((model) => `<code>${e(model)}</code>`).join(", ")}.</p>`);
    }
    body.push(
      '<p class="nota">Estimativa da cozinha: tokens de cada etapa vezes a tabela de <code>backend/src/edition/cost.ts</code>, mais US$ 0,01 por busca na web. Tokens em cache não têm desconto aqui, então o valor tende a ficar um pouco acima do cobrado. Para conferir, compare o total do mês com a página Usage da OpenAI.</p>'
    );
  }
  return section("custo", "OpenAI", "Custo", body.join("\n"));
}

// ---------------------------------------------------------------------------------------------
// Edition quality

function qualitySection(runs: GithubRun[] | null): string {
  if (!runs) return "";
  const rows: Array<{ date: string; job: RunReportJob }> = [];
  const seen = new Set<string>();
  for (const run of runs) {
    for (const report of [...run.reports].reverse()) {
      for (const job of report.jobs) {
        if (job.kind !== "edition" || !job.quality || !job.editionId || seen.has(job.editionId)) continue;
        seen.add(job.editionId);
        rows.push({ date: report.finishedAt, job });
      }
    }
  }
  if (rows.length === 0) {
    return section(
      "qualidade",
      "Edição",
      "Qualidade",
      '<p class="nota">Quantos itens entraram, quantos feeds falharam e quanto a auditoria cortou aparecem aqui a partir da próxima edição publicada: os relatórios anteriores não traziam esses números.</p>'
    );
  }
  const table_ = table(
    "Cada edição escrita na janela, da mais nova à mais antiga",
    ["Edição", "Itens", "Com resumo", "Feeds com falha", "Auditoria cortou", "Checagem cortou", "Manchete", "Notas das etapas"],
    rows.map(({ date, job }) => {
      const q = job.quality!;
      const notes = q.stepNotes.map((id) => NOTE_LABEL[id] ?? id.replace(/^pulso-/, ""));
      return [
        `${e(formatWhen(date))}${q.kind === "quiet" ? ` ${pill("vazia", "warn")}` : ""}`,
        e(formatInt(q.items)),
        e(formatInt(q.withSummary)),
        q.feedsFailed > 0 ? pill(formatInt(q.feedsFailed), "warn") : "0",
        q.audited === null ? DASH : e(`${formatInt(q.auditRemoved)} de ${formatInt(q.audited)}`),
        e(formatInt(q.gateDropped)),
        q.headlineFellBack ? pill("títulos das fontes", "warn", "o texto gerado não passou na checagem") : pill("gerada", "ok"),
        notes.length > 0 ? e(notes.join(", ")) : DASH,
      ];
    }),
    [1, 2, 3, 4, 5]
  );
  return section(
    "qualidade",
    "Edição",
    "Qualidade",
    `${table_}\n<p class="nota">“Notas das etapas” são os avisos que a própria cozinha registrou na edição (auditoria, custo, classificação); o texto de cada um está no log da corrida.</p>`
  );
}

// ---------------------------------------------------------------------------------------------
// Runs

/** A run worth a row of its own: it failed, wrote something, spent money, or is still going. */
function notable(run: GithubRun): boolean {
  if (run.status !== "completed") return true;
  // A push to main with no kitchen job is skipped by design; it says nothing about the edition.
  if (run.conclusion === "skipped") return false;
  if (run.conclusion !== "success") return true;
  const report = run.reports.at(-1);
  if (!report) return false;
  if (report.outcome === "failed" || report.catalogue === "captured" || report.catalogue === "failed") return true;
  if (report.cost.totalUsd > 0) return true;
  return report.jobs.some((job) => job.status === "published" || job.status === "partial" || (job.status === "error" && job.skippedReason !== "slot-already-published"));
}

function runRows(runs: GithubRun[]): string[][] {
  return runs.map((run) => {
    const duration = run.status === "completed" && run.startedAt ? formatDuration(Date.parse(run.updatedAt) - Date.parse(run.startedAt)) : DASH;
    const usd = run.reports.length > 0 ? run.reports.reduce((sum, report) => sum + report.cost.totalUsd, 0) : null;
    return [
      githubLink(run.url, formatWhen(run.createdAt)),
      e(EVENT_LABEL[run.event] ?? run.event) + (run.attempt > 1 ? ` <span class="muted">tentativa ${run.attempt}</span>` : ""),
      runResult(run),
      e(duration),
      kitchenSummary(run),
      e(formatUsd(usd)),
    ];
  });
}

function runsSection(snapshot: HealthSnapshot): string {
  if (snapshot.github.state !== "ok") return section("corridas", "GitHub Actions", "Corridas", notice(snapshot.github, "as corridas do GitHub Actions"));
  const { runs, repo, workflow } = snapshot.github.data;
  if (runs.length === 0) return section("corridas", "GitHub Actions", "Corridas", `<p>Nenhuma corrida de <code>${e(workflow)}</code> nos últimos ${snapshot.days} dias.</p>`);
  const head = ["Quando", "Origem", "Resultado", "Duração", "Cozinha", "Custo"];
  const main = runs.filter(notable);
  const rest = runs.filter((run) => !notable(run));
  const parts = [
    main.length > 0
      ? table(`As que publicaram, gastaram ou falharam em ${repo} (horário de Brasília)`, head, runRows(main), [3, 5])
      : `<p class="nota">Nenhuma corrida da janela publicou, gastou ou falhou.</p>`,
  ];
  if (rest.length > 0) {
    parts.push(
      `<details class="mais"><summary>Mais ${formatInt(rest.length)} corrida(s) sem nada novo: a edição já tinha saído, push na main sem cozinha, ou anteriores ao relatório</summary>${table(`Demais corridas de ${workflow}`, head, runRows(rest), [3, 5])}</details>`
    );
  }
  parts.push('<p class="nota">“Disparo” inclui o Worker e os pedidos manuais. O resultado é o da corrida inteira: cozinha, site, deploy e conferência do site no ar.</p>');
  return section("corridas", "GitHub Actions", "Corridas", parts.join("\n"));
}

function workerDetail(snapshot: HealthSnapshot): string {
  if (snapshot.cloudflare.state !== "ok") return "";
  const { slots, worker, unmatched } = snapshot.cloudflare.data;
  const bad = slots.filter((slot) => slot.state === "failed" || slot.state === "missing");
  if (bad.length === 0 && unmatched.length === 0) return "";
  const rows = bad
    .reverse()
    .map((slot) => [
      e(formatWhen(slot.scheduledAt)),
      slot.state === "failed" ? pill("falhou", "bad", slot.status) : pill("sem disparo", "bad"),
      e(slot.state === "failed" ? "o pedido ao GitHub falhou nas três tentativas" : "a Cloudflare não disparou o cron"),
    ]);
  const extra =
    unmatched.length > 0
      ? `<p class="nota">Mais ${formatInt(unmatched.length)} invocação(ões) fora dos horários do <code>wrangler.jsonc</code> (disparo manual pelo painel da Cloudflare, ou um cron antigo).</p>`
      : "";
  return section("disparador", "Cloudflare", `Disparos perdidos do ${worker}`, `${table("Horários do cron que não viraram corrida", ["Horário", "Estado", "O que quer dizer"], rows)}${extra}`);
}

// ---------------------------------------------------------------------------------------------
// Page

const CSS = `
:root { color-scheme: light; --canvas: #fbf7f2; --ink: #17120f; --muted: #6b625b; --card: rgba(255,253,250,.86);
  --line: rgba(23,18,15,.1); --line-strong: rgba(23,18,15,.24); --casca: rgba(23,18,15,.025); --casca-linha: rgba(23,18,15,.07);
  --shadow: 0 14px 34px rgba(92,58,44,.12); --highlight: inset 0 1px 0 rgba(255,255,255,.75);
  --background: radial-gradient(ellipse 70% 45% at 88% 0%, rgba(236,143,110,.1), transparent 70%), linear-gradient(180deg,#fbf7f2 0%,#fbf7f2 62%,#f5e2d6 100%);
  --luz: linear-gradient(150deg,#f0b35a 0%,#ec8f6e 45%,#d97f8c 75%,#b07a9e 100%);
  --ok: #3f6b4e; --ok-fundo: rgba(63,107,78,.1); --warn: #9a5a12; --warn-fundo: rgba(240,179,90,.18); --bad: #b23a26; --bad-fundo: rgba(236,143,110,.18);
  --serif: "Playfair Display", Georgia, "Times New Roman", serif; --sans: "IBM Plex Sans", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
@media (prefers-color-scheme: dark) { :root { color-scheme: dark; --canvas: #110d0b; --ink: #f4ede6; --muted: #a69c94; --card: rgba(22,17,14,.86);
  --line: rgba(244,237,230,.1); --line-strong: rgba(244,237,230,.24); --casca: rgba(244,237,230,.035); --casca-linha: rgba(244,237,230,.09);
  --shadow: 0 14px 34px rgba(0,0,0,.35); --highlight: inset 0 1px 0 rgba(255,255,255,.06);
  --background: radial-gradient(ellipse 70% 45% at 88% 0%, rgba(236,143,110,.12), transparent 70%), #110d0b;
  --ok: #8fbf98; --ok-fundo: rgba(143,191,152,.12); --warn: #f0b35a; --warn-fundo: rgba(240,179,90,.14); --bad: #ec8f6e; --bad-fundo: rgba(236,143,110,.16); } }
* { box-sizing: border-box; border-color: var(--line); }
html { background: var(--canvas); }
body { margin: 0; min-height: 100vh; background: var(--background); color: var(--ink); font: 1rem/1.6 var(--sans); -webkit-font-smoothing: antialiased; }
main { max-width: 68rem; margin: 0 auto; padding: 3.5rem 1.25rem 5rem; }
a { color: var(--ink); text-decoration: underline; text-decoration-color: var(--line-strong); text-decoration-thickness: 1px; text-underline-offset: .26em; }
a:hover { text-decoration-color: var(--ink); }
code { font: .85em var(--mono); background: var(--casca); border: 1px solid var(--casca-linha); padding: .05rem .35rem; border-radius: .4rem; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.kicker, .cartao-rotulo, .faixa-nome, thead th, caption, .eixo, .legenda { color: var(--muted); font-family: var(--mono); font-size: .75rem; font-weight: 500; letter-spacing: .1em; text-transform: uppercase; }
.kicker { margin: 0 0 .75rem; }
.titulo { margin: 0; max-width: 22ch; font: 500 clamp(2.1rem, 4.4vw, 3.25rem)/1.06 var(--serif); letter-spacing: -.035em; }
.titulo-secao { margin: 0 0 1.25rem; font: 500 clamp(1.5rem, 2.6vw, 2rem)/1.12 var(--serif); letter-spacing: -.025em; }
.subtitulo { margin: 1.75rem 0 .75rem; font: 600 .95rem/1.4 var(--sans); }
.nota { color: var(--muted); font-size: .875rem; line-height: 1.6; max-width: 70ch; }
.muted { color: var(--muted); }
.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }

.veredito { position: relative; padding: 2rem 2rem 1.5rem; border: 1px solid var(--line); border-radius: 1.5rem; background: var(--card); box-shadow: var(--shadow), var(--highlight); overflow: hidden; }
.veredito::before { content: ""; position: absolute; inset: 0 0 auto; height: 4px; background: var(--luz); }
.veredito--bad::before { background: var(--bad); } .veredito--warn::before { background: var(--warn); }
.veredito-linha { display: flex; align-items: flex-start; gap: .9rem; }
.selo { flex: none; width: .9rem; height: .9rem; margin-top: .85rem; border-radius: 999px; background: var(--muted); box-shadow: 0 0 0 .35rem var(--casca); }
.veredito--ok .selo { background: var(--ok); box-shadow: 0 0 0 .35rem var(--ok-fundo); }
.veredito--warn .selo { background: var(--warn); box-shadow: 0 0 0 .35rem var(--warn-fundo); }
.veredito--bad .selo { background: var(--bad); box-shadow: 0 0 0 .35rem var(--bad-fundo); }
.linha-fatos { display: flex; flex-wrap: wrap; gap: .35rem .75rem; margin: 1rem 0 0 1.8rem; color: var(--ink); font-family: var(--mono); font-size: .8125rem; letter-spacing: .04em; }
.linha-fatos > * + *::before { content: ""; display: inline-block; width: 1px; height: .8em; margin-right: .75rem; background: var(--line-strong); vertical-align: -.05em; }
.pendencias { list-style: none; margin: 1.25rem 0 0 1.8rem; padding: 0; display: grid; gap: .5rem; }
.pendencia { display: flex; gap: .6rem; align-items: baseline; font-size: .95rem; }
.ponto { flex: none; width: .5rem; height: .5rem; border-radius: 999px; transform: translateY(-.1rem); }
.pendencia--warn .ponto { background: var(--warn); } .pendencia--bad .ponto { background: var(--bad); }
.veredito .nota { margin: 1.25rem 0 0 1.8rem; }

.bloco { margin-top: 3.5rem; padding-top: 2rem; border-top: 1px solid var(--line); }
.aviso { padding: .75rem 1rem; border: 1px solid var(--casca-linha); border-radius: .9rem; background: var(--casca); }
.aviso--bad strong { color: var(--bad); }

.faixa { margin-bottom: 1.25rem; }
.faixa-topo { display: flex; justify-content: space-between; gap: 1rem; margin-bottom: .45rem; }
.faixa-nome { color: var(--ink); }
.faixa-resumo { color: var(--muted); font-size: .875rem; }
.dias { display: flex; gap: 3px; }
.dia { display: inline-block; flex: 1 1 0; min-width: 4px; height: 2.25rem; border-radius: 3px; background: var(--casca-linha); }
.dia--ok { background: var(--ok); } .dia--warn { background: var(--warn); } .dia--bad { background: var(--bad); }
.dia--idle { background: var(--line-strong); }
.eixo { display: flex; justify-content: space-between; letter-spacing: .06em; margin-top: -.5rem; }
.legenda { display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; margin: 1rem 0 0; letter-spacing: .06em; }
.legenda > span { display: inline-flex; align-items: center; gap: .4rem; }
.legenda .dia { flex: none; width: .7rem; height: .7rem; }
.monitores { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 1rem; background: var(--card); }
.monitor { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem 1rem; padding: .85rem 1.1rem; }
.monitor + .monitor { border-top: 1px solid var(--line); }
.monitor-nome { font-weight: 600; min-width: 10rem; }
.monitor-meta { margin-left: auto; color: var(--muted); font-family: var(--mono); font-size: .75rem; letter-spacing: .04em; }

.pill { display: inline-flex; align-items: center; padding: .05rem .55rem; border: 1px solid var(--line-strong); border-radius: 999px; font-family: var(--mono); font-size: .72rem; letter-spacing: .04em; white-space: nowrap; }
.pill--ok { color: var(--ok); border-color: transparent; background: var(--ok-fundo); }
.pill--warn { color: var(--warn); border-color: transparent; background: var(--warn-fundo); }
.pill--bad { color: var(--bad); border-color: transparent; background: var(--bad-fundo); font-weight: 600; }
.pill--muted { color: var(--muted); }

.cartoes { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: .75rem; }
.cartao { padding: 1.1rem 1.25rem; border: 1px solid var(--line); border-radius: 1.1rem; background: var(--card); box-shadow: var(--highlight); }
.cartao-rotulo { margin: 0; }
.cartao-valor { margin: .35rem 0 0; font: 500 1.9rem/1.1 var(--serif); letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.cartao-valor a { text-decoration-color: var(--line-strong); }
.cartao-detalhe { margin: .5rem 0 0; color: var(--muted); font-size: .8125rem; }
.teto { display: block; height: 5px; margin: .1rem 0 .4rem; border-radius: 999px; background: var(--casca-linha); overflow: hidden; }
.teto > span { display: block; height: 100%; background: var(--luz); }

.grafico { margin-top: 1.5rem; padding: 1.25rem 1.25rem 1rem; border: 1px solid var(--line); border-radius: 1.1rem; background: var(--card); }
.grafico-colunas { display: flex; align-items: flex-end; gap: 4px; height: 8rem; margin-bottom: 1.1rem; }
.coluna-dia { flex: 1 1 0; height: 100%; display: flex; align-items: flex-end; }
.coluna-dia > span { display: block; width: 100%; border-radius: 3px 3px 1px 1px; background: var(--luz); }
.coluna-dia--vazia { border-bottom: 2px dotted var(--line-strong); }
.grafico .eixo { margin-top: 0; }

.colunas { display: grid; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); gap: 0 2.5rem; }
.barras { list-style: none; margin: 0; padding: 0; display: grid; gap: .9rem; }
.barra-topo { display: flex; justify-content: space-between; gap: 1rem; font-size: .95rem; }
.barra { height: 6px; margin-top: .35rem; border-radius: 999px; background: var(--casca-linha); overflow: hidden; }
.barra > span { display: block; height: 100%; border-radius: 999px; background: var(--ink); opacity: .78; }
.barra-detalhe { margin: .3rem 0 0; color: var(--muted); font-family: var(--mono); font-size: .72rem; letter-spacing: .03em; }

.tabela { overflow-x: auto; border: 1px solid var(--line); border-radius: 1rem; background: var(--card); margin: 1rem 0; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; font-size: .925rem; }
caption { text-align: left; padding: .9rem 1rem .5rem; }
th, td { text-align: left; padding: .6rem 1rem; border-top: 1px solid var(--line); vertical-align: middle; }
thead th { border-top: 0; font-size: .7rem; }
tbody th { font-weight: 400; white-space: nowrap; }
.mais { margin-top: .5rem; }
.mais summary { cursor: pointer; color: var(--muted); font-size: .9rem; }
.mais summary:hover { color: var(--ink); }
:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; border-radius: 4px; }
@media (max-width: 640px) { .veredito { padding: 1.5rem 1.25rem 1.25rem; } .linha-fatos, .pendencias, .veredito .nota { margin-left: 0; } .monitor-meta { margin-left: 0; } }
`;

export function renderHealthPage(snapshot: HealthSnapshot, options: { fontCss?: string } = {}): string {
  const now = new Date(snapshot.generatedAt);
  const runs = snapshot.github.state === "ok" ? snapshot.github.data.runs : null;
  const cost = runs ? summarizeCost(runs, { since: new Date(snapshot.since), now }) : null;
  const repo = snapshot.github.state === "ok" ? snapshot.github.data.repo : "";
  const v = verdict({ runs, healthchecks: snapshot.healthchecks, cloudflare: snapshot.cloudflare, now });

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">
<meta name="referrer" content="no-referrer">
<title>${e(`Painel do Pulso · ${VERDICT_MARK[v.level]}`)}</title>
<style>${options.fontCss ?? ""}${CSS}</style>
</head>
<body>
<main>
${verdictBlock(v, snapshot, repo)}
${statusSection(snapshot, runs)}
${costSection(snapshot, cost)}
${qualitySection(runs)}
${workerDetail(snapshot)}
${runsSection(snapshot)}
</main>
</body>
</html>
`;
}
