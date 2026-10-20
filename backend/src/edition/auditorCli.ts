import dotenv from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditSummary, type AuditorModel } from "./auditor.js";
import { auditorFromEnv, DEFAULT_OPENAI_AUDITOR_EFFORT } from "./auditorModels.js";
import {
  EVAL_CASES,
  outcomeFrom,
  scoreOutcomes,
  type CaseOutcome,
  type EvalScore,
} from "./auditorEval.js";
import { repoRoot } from "./paths.js";

/**
 * Runs the seeded-error corpus against a configured auditor and writes the report.
 *
 * Usage:
 *   npx tsx src/edition/auditorCli.ts
 *   PULSO_AUDITOR_MODEL=<outro-modelo> npx tsx src/edition/auditorCli.ts
 *
 * Results are appended as a new section, so runs against different providers accumulate in one
 * file and can be compared. Nothing here decides anything: it produces the numbers the decision
 * needs.
 */

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../../.env") });

const CONCURRENCY = 3;

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function report(
  provider: string,
  model: AuditorModel,
  effort: string | undefined,
  outcomes: CaseOutcome[],
  score: EvalScore,
  tokens: { input: number; output: number },
  elapsedMs: number
): string {
  const lines: string[] = [];
  lines.push(
    `## ${provider} · \`${model.id}\`${effort ? ` · reasoning ${effort}` : ""} · ` +
      new Date().toISOString().slice(0, 10)
  );
  lines.push("");
  lines.push(
    `Detecção **${pct(score.detectionRate)}** (${score.caught}/${score.seeded} defeitos semeados) · ` +
      `falso positivo **${pct(score.falsePositiveRate)}** (${score.falsePositives}/${score.clean} resumos fiéis rejeitados)`
  );
  lines.push("");
  lines.push(
    `${tokens.input} tokens de entrada, ${tokens.output} de saída, ${(elapsedMs / 1000).toFixed(1)}s, ` +
      `${score.unusable} resposta(s) inutilizável(is).`
  );
  lines.push("");
  lines.push("| defeito | semeados | pegos |");
  lines.push("| --- | --- | --- |");
  for (const row of score.byFault) {
    lines.push(`| ${row.fault} | ${row.seeded} | ${row.caught} |`);
  }
  lines.push("");
  lines.push("| caso | esperado | auditor | apontamentos | veredito |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of outcomes) {
    const expected = row.expectSupported ? "sustentado" : "não sustentado";
    const actual =
      row.actualSupported === null
        ? `inutilizável (${row.error ?? "?"})`
        : row.actualSupported
          ? "sustentado"
          : "não sustentado";
    const correct = row.actualSupported === row.expectSupported;
    lines.push(
      `| \`${row.id}\` | ${expected} | ${actual} | ${row.findings} | ${correct ? "✅" : "❌"} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const configured = auditorFromEnv({
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    PULSO_AUDITOR_PROVIDER: process.env.PULSO_AUDITOR_PROVIDER,
    PULSO_AUDITOR_MODEL: process.env.PULSO_AUDITOR_MODEL,
    PULSO_AUDITOR_REASONING_EFFORT: process.env.PULSO_AUDITOR_REASONING_EFFORT,
  });
  if ("reason" in configured) {
    process.stderr.write(`auditor não configurado: ${configured.reason}\n`);
    process.exitCode = 1;
    return;
  }
  const effort =
    configured.provider === "openai"
      ? (process.env.PULSO_AUDITOR_REASONING_EFFORT ?? DEFAULT_OPENAI_AUDITOR_EFFORT)
      : undefined;

  const started = Date.now();
  let input = 0;
  let output = 0;

  const outcomes = await mapPool(EVAL_CASES, CONCURRENCY, async (testCase) => {
    const result = await auditSummary(
      {
        body: testCase.body,
        summary: testCase.summary,
        title: testCase.title,
        outlet: testCase.outlet,
      },
      configured.model
    );
    if (result.usage) {
      input += result.usage.inputTokens;
      output += result.usage.outputTokens;
    }
    return outcomeFrom(testCase, result.verdict, result.error);
  });

  const score = scoreOutcomes(outcomes);
  const section = report(
    configured.provider,
    configured.model,
    effort,
    outcomes,
    score,
    { input, output },
    Date.now() - started
  );

  const target = path.join(repoRoot(), "research", "auditor-eval.md");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${section}\n`, { flag: "a" });

  process.stdout.write(section);
  process.stdout.write(`\nanexado em ${path.relative(repoRoot(), target)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
