/**
 * The script stage of the Pulso da Semana. Driven by `semana.ts` (`npm run semana -- roteiro`),
 * it writes only under the week's working folder (`cli.ts` → `pilotDir`).
 *
 * `runScript` calls OpenAI (editor, writer, voice director, at most one revision, and the
 * auditor configured for the edition) and never touches ElevenLabs. `recheckScript` runs the
 * same gate and audit on a script edited by hand, so a human change goes through the checks a
 * generated one does. Neither approves anything: approval is a separate, explicit step.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { auditorFromEnv } from "../edition/auditorModels.js";
import { auditScript } from "./audit.js";
import { fileSha256, pilotDir, repoRoot } from "./cli.js";
import { gateScript, type GateReport } from "./gate.js";
import { loadWeek, type WeeklyInput } from "./input.js";
import { appendCalls, callsTotal, formatUsd } from "./ledger.js";
import { directScript, planWeek, reviseTurns, writeScript, type CallLog, type Finding, type NarrativeOptions } from "./narrative.js";
import { outlineSchema, renderScriptText, SPEAKER_ROLE, type EpisodeScript, type Outline } from "./script.js";

/**
 * Pinned rather than following the edition's editorial model: the published episodes were
 * written, directed and checked on Terra, and a writer change for the audio deserves its own
 * pilot episode before it ships. Override with OPENAI_MODEL_WEEKLY to try another model.
 */
const WEEKLY_WRITER_MODEL = "gpt-5.6-terra";

/** One verdict over the whole script: findings for many turns, plus reasoning on OpenAI. */
const WEEKLY_AUDIT_MAX_OUTPUT_TOKENS = 12_000;

export const APPROVAL_FILE = "approval.json";

export interface ScriptStatus {
  passed: boolean;
  /** sha256 of the script.json these checks ran on. */
  scriptSha256: string | null;
  checkedAt: string;
  problems: GateReport["problems"];
  findings: Finding[];
}

function save(dir: string, name: string, data: unknown): void {
  writeFileSync(path.join(dir, name), typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`);
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function textOptions(): NarrativeOptions {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY ausente em backend/.env");
  return { client: new OpenAI({ apiKey }), model: process.env.OPENAI_MODEL_WEEKLY ?? WEEKLY_WRITER_MODEL };
}

function weeklyAuditor() {
  // A whole script yields more findings than one paragraph, and a reasoning model spends tokens
  // before answering, so the edition's per-verdict cap would truncate the verdict into unreadable
  // JSON. Same provider choice as the edition, bigger budget.
  const auditor = auditorFromEnv(process.env, { maxOutputTokens: WEEKLY_AUDIT_MAX_OUTPUT_TOKENS });
  if ("reason" in auditor) throw new Error(`auditor indisponível: ${auditor.reason}`);
  return auditor.model;
}

/** Gate, then audit; both saved under `label` so every round stays on disk. */
async function checkRound(
  dir: string,
  script: EpisodeScript,
  input: WeeklyInput,
  auditor: ReturnType<typeof weeklyAuditor>,
  logs: CallLog[],
  label: string
): Promise<{ gate: GateReport; findings: Finding[] }> {
  const gate = gateScript(script, input);
  save(dir, `gate-${label}.json`, gate);
  const audit = await auditScript(script, input, auditor).catch((err: Error & { raw?: string }) => {
    if (err.raw) save(dir, `audit-${label}.raw.txt`, err.raw);
    throw err;
  });
  save(dir, `audit-${label}.json`, audit);
  logs.push({ step: `auditoria ${label}`, model: audit.model, ...(audit.usage ? { usage: audit.usage } : {}) });
  const findings: Finding[] = [
    ...gate.problems.filter((p) => p.turnId).map((p) => ({ turnId: p.turnId!, excerpt: "", why: p.problem })),
    ...audit.findings,
  ];
  console.log(
    `checagem ${label}: ${gate.chars} caracteres, ${gate.tags} tags, ${SPEAKER_ROLE.host.label.toLowerCase()} ` +
      `${(gate.share.host * 100).toFixed(0)}%, ${gate.problems.length} problema(s) no gate, ` +
      `${audit.findings.length} apontamento(s) da auditoria`
  );
  return { gate, findings };
}

/**
 * Writes the script, its readable text and the verdict. Any approval on disk is removed: it was
 * given to a different text, and leaving it would let the audio run on words nobody read.
 */
function settle(dir: string, script: EpisodeScript, result: { gate: GateReport; findings: Finding[] }, logs: CallLog[]): boolean {
  save(dir, "script.json", script);
  save(dir, "script.txt", renderScriptText(script));
  rmSync(path.join(dir, APPROVAL_FILE), { force: true });
  const added = appendCalls(dir, logs);
  const globalProblems = result.gate.problems.filter((p) => !p.turnId);
  const passed = result.findings.length === 0 && globalProblems.length === 0;
  const status: ScriptStatus = {
    passed,
    scriptSha256: fileSha256(path.join(dir, "script.json")),
    checkedAt: new Date().toISOString(),
    problems: result.gate.problems,
    findings: result.findings,
  };
  save(dir, "script-status.json", status);
  for (const p of globalProblems) console.log(`  ! ${p.problem}`);
  for (const f of result.findings) console.log(`  ! ${f.turnId}: ${f.excerpt} — ${f.why}`);
  const { usd, unpriced } = callsTotal(added);
  console.log(`custo desta etapa: ${formatUsd(usd)}${unpriced.length ? ` (sem preço: ${unpriced.join(", ")})` : ""}`);
  console.log(
    passed
      ? `roteiro passou nas checagens → ${path.relative(repoRoot, dir)}/script.txt (falta a aprovação humana)`
      : "roteiro REPROVADO nas checagens; o áudio fica bloqueado"
  );
  return passed;
}

export async function runScript(
  weekStart: string,
  options: { editionsDir?: string; reuseOutline?: boolean; reuseDraft?: boolean; reuseDirected?: boolean } = {}
): Promise<boolean> {
  // The kitchen's editions, as `npm run kitchen:export` writes them. The site no longer publishes
  // the edition JSON this reads, so `dist-site/editions` has nothing to read.
  const editionsDir = options.editionsDir ?? path.join(repoRoot, "data/editions");
  const input = loadWeek(editionsDir, weekStart);
  if (input.editionIds.length === 0) {
    throw new Error(`nenhuma edição de ${input.from} a ${input.to} em ${path.relative(repoRoot, editionsDir)}; rode \`npm run semana -- preparar\``);
  }
  const dir = pilotDir(input.weekId);
  save(dir, "weekly-input.json", input);
  console.log(`${input.weekId}: ${input.editionIds.length} edições, ${input.stories.length} histórias únicas`);

  const text = textOptions();
  const auditor = weeklyAuditor();
  const logs: CallLog[] = [];

  const reuseOutline = options.reuseOutline && existsSync(path.join(dir, "outline.json"));
  const outline: Outline = reuseOutline
    ? outlineSchema.parse(readJson(path.join(dir, "outline.json")))
    : await planWeek(input, text).then(({ outline, log }) => (logs.push(log), outline));
  save(dir, "outline.json", outline);
  console.log(`formato: ${outline.format} — ${outline.title}\n  ${outline.formatReason}`);

  let script: EpisodeScript;
  if (options.reuseDraft && existsSync(path.join(dir, "draft.json"))) {
    script = readJson<EpisodeScript>(path.join(dir, "draft.json"));
  } else {
    const written = await writeScript(input, outline, text);
    script = written.script;
    logs.push(written.log);
    save(dir, "draft.json", script);
  }
  save(dir, "draft.txt", renderScriptText(script));

  // The director never sees the sources, so its output goes through the same gate and audit.
  if (options.reuseDirected && existsSync(path.join(dir, "directed.json"))) {
    script = readJson<EpisodeScript>(path.join(dir, "directed.json"));
  } else {
    const directed = await directScript(script, text);
    script = directed.script;
    logs.push(directed.log);
    save(dir, "directed.json", script);
  }

  let result = await checkRound(dir, script, input, auditor, logs, "r1");
  if (result.findings.length > 0) {
    const revised = await reviseTurns(input, script, result.findings, text);
    script = revised.script;
    logs.push(revised.log);
    result = await checkRound(dir, script, input, auditor, logs, "r2");
  }
  return settle(dir, script, result, logs);
}

/**
 * Checks `script.json` as it is now — after a hand edit, typically. With `revise`, flagged turns
 * get one automatic revision first, as in the generated run.
 */
export async function recheckScript(weekStart: string, options: { weekId: string; revise?: boolean }): Promise<boolean> {
  const dir = pilotDir(options.weekId);
  for (const name of ["script.json", "weekly-input.json"]) {
    if (!existsSync(path.join(dir, name))) throw new Error(`${name} ausente em ${path.relative(repoRoot, dir)}; rode \`roteiro\` primeiro`);
  }
  let script = readJson<EpisodeScript>(path.join(dir, "script.json"));
  const input = readJson<WeeklyInput>(path.join(dir, "weekly-input.json"));
  if (input.from !== weekStart) throw new Error(`a pasta ${options.weekId} é da semana de ${input.from}, não de ${weekStart}`);
  const auditor = weeklyAuditor();
  const logs: CallLog[] = [];
  const round = (n: number) => `c${Date.now().toString(36)}-${n}`;

  let result = await checkRound(dir, script, input, auditor, logs, round(1));
  if (options.revise && result.findings.length > 0) {
    const revised = await reviseTurns(input, script, result.findings, textOptions());
    script = revised.script;
    logs.push(revised.log);
    result = await checkRound(dir, script, input, auditor, logs, round(2));
  }
  return settle(dir, script, result, logs);
}
