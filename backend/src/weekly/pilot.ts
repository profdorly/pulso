/**
 * Local pilot of the weekly audio episode. Writes only under `.tmp/weekly-audio-pilot/`.
 *
 *   npx tsx src/weekly/pilot.ts script --week-start 2026-09-28
 *   npx tsx src/weekly/pilot.ts audio  --week-start 2026-09-28 --max-credits 12000
 *   npx tsx src/weekly/pilot.ts verify --week-start 2026-09-28
 *
 * `script` calls OpenAI (editor, writer, voice director, at most one revision, and the auditor
 * configured for the edition) and never touches ElevenLabs. `audio` reads the frozen script and
 * is the only step that spends credits. `verify` transcribes the generated audio and compares it
 * with the script.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { auditorFromEnv } from "../edition/auditorModels.js";
import { auditScript } from "./audit.js";
import { arg, pilotDir, repoRoot } from "./cli.js";
import { gateScript } from "./gate.js";
import { loadWeek } from "./input.js";
import { directScript, planWeek, reviseTurns, writeScript, type CallLog, type Finding } from "./narrative.js";
import { outlineSchema, renderScriptText, SPEAKER_ROLE, type EpisodeScript, type Outline } from "./script.js";

/**
 * Pinned rather than following the edition's editorial model: the published episodes were
 * written, directed and checked on Terra, and a writer change for the audio deserves its own
 * pilot episode before it ships. Override with OPENAI_MODEL_WEEKLY to try another model.
 */
const WEEKLY_WRITER_MODEL = "gpt-5.6-terra";

/** One verdict over the whole script: findings for many turns, plus reasoning on OpenAI. */
const WEEKLY_AUDIT_MAX_OUTPUT_TOKENS = 12_000;

function save(dir: string, name: string, data: unknown): void {
  writeFileSync(path.join(dir, name), typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`);
}

async function runScript(): Promise<void> {
  // The kitchen's editions, as `npm run kitchen:export` writes them. The site no longer publishes
  // the edition JSON this reads, so `dist-site/editions` has nothing to read.
  const editionsDir = path.resolve(repoRoot, arg("--editions", "data/editions"));
  const input = loadWeek(editionsDir, arg("--week-start"));
  const dir = pilotDir(input.weekId);
  save(dir, "weekly-input.json", input);
  console.log(`${input.weekId}: ${input.editionIds.length} edições, ${input.stories.length} histórias únicas`);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY ausente em backend/.env");
  const options = { client: new OpenAI({ apiKey }), model: process.env.OPENAI_MODEL_WEEKLY ?? WEEKLY_WRITER_MODEL };
  // A whole script yields more findings than one paragraph, and a reasoning model spends tokens
  // before answering, so the edition's per-verdict cap would truncate the verdict into unreadable
  // JSON. Same provider choice as the edition, bigger budget.
  const auditor = auditorFromEnv(process.env, { maxOutputTokens: WEEKLY_AUDIT_MAX_OUTPUT_TOKENS });
  if ("reason" in auditor) throw new Error(`auditor indisponível: ${auditor.reason}`);
  const logs: CallLog[] = [];

  const reuseOutline = existsSync(path.join(dir, "outline.json")) && process.argv.includes("--reuse-outline");
  const outline: Outline = reuseOutline
    ? outlineSchema.parse(JSON.parse(readFileSync(path.join(dir, "outline.json"), "utf8")))
    : await planWeek(input, options).then(({ outline, log }) => (logs.push(log), outline));
  save(dir, "outline.json", outline);
  console.log(`formato: ${outline.format} — ${outline.title}\n  ${outline.formatReason}`);

  const reuseScript = existsSync(path.join(dir, "draft.json")) && process.argv.includes("--reuse-draft");
  let script: EpisodeScript;
  if (reuseScript) {
    script = JSON.parse(readFileSync(path.join(dir, "draft.json"), "utf8")) as EpisodeScript;
  } else {
    const written = await writeScript(input, outline, options);
    script = written.script;
    logs.push(written.log);
    save(dir, "draft.json", script);
  }
  save(dir, "draft.txt", renderScriptText(script));

  // The director never sees the sources, so its output goes through the same gate and audit.
  const reuseDirected = existsSync(path.join(dir, "directed.json")) && process.argv.includes("--reuse-directed");
  if (reuseDirected) {
    script = JSON.parse(readFileSync(path.join(dir, "directed.json"), "utf8")) as EpisodeScript;
  } else {
    const directed = await directScript(script, options);
    script = directed.script;
    logs.push(directed.log);
    save(dir, "directed.json", script);
  }

  const check = async (current: EpisodeScript, round: number) => {
    const gate = gateScript(current, input);
    save(dir, `gate-r${round}.json`, gate);
    const audit = await auditScript(current, input, auditor.model).catch((err: Error & { raw?: string }) => {
      if (err.raw) save(dir, `audit-r${round}.raw.txt`, err.raw);
      throw err;
    });
    save(dir, `audit-r${round}.json`, audit);
    logs.push({ step: `auditoria r${round}`, model: audit.model, ...(audit.usage ? { usage: audit.usage } : {}) });
    const findings: Finding[] = [
      ...gate.problems.filter((p) => p.turnId).map((p) => ({ turnId: p.turnId!, excerpt: "", why: p.problem })),
      ...audit.findings,
    ];
    console.log(
      `rodada ${round}: ${gate.chars} caracteres, ${gate.tags} tags, ${SPEAKER_ROLE.host.label.toLowerCase()} ` +
        `${(gate.share.host * 100).toFixed(0)}%, ${gate.problems.length} problema(s) no gate, ` +
        `${audit.findings.length} apontamento(s) da auditoria`
    );
    return { gate, findings };
  };

  let result = await check(script, 1);
  if (result.findings.length > 0) {
    const revised = await reviseTurns(input, script, result.findings, options);
    script = revised.script;
    logs.push(revised.log);
    result = await check(script, 2);
  }

  save(dir, "script.json", script);
  save(dir, "script.txt", renderScriptText(script));
  save(dir, "calls.json", logs);
  const globalProblems = result.gate.problems.filter((p) => !p.turnId);
  const passed = result.findings.length === 0 && globalProblems.length === 0;
  save(dir, "script-status.json", { passed, problems: result.gate.problems, findings: result.findings });
  for (const p of globalProblems) console.log(`  ! ${p.problem}`);
  for (const f of result.findings) console.log(`  ! ${f.turnId}: ${f.excerpt} — ${f.why}`);
  console.log(passed ? `roteiro aprovado → ${path.relative(repoRoot, dir)}/script.txt` : "roteiro REPROVADO; áudio bloqueado");
  if (!passed) process.exitCode = 1;
}

const command = process.argv[2];
if (command === "script") {
  await runScript();
} else if (command === "audio") {
  const { runAudio } = await import("./audioPilot.js");
  await runAudio();
} else if (command === "verify") {
  const { runVerify } = await import("./verify.js");
  await runVerify();
} else {
  console.error("uso: pilot.ts script|audio|verify --week-start AAAA-MM-DD");
  process.exitCode = 2;
}
