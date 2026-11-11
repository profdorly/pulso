import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { repoRoot } from "../edition/paths.js";
import { mapLimit } from "./source.js";
import { latestPerEdition, parseShadowReports, renderShadowSummary, summarizeShadow, type ShadowLogReport } from "./shadowSummary.js";

/**
 * Summarises the web search's shadow reports from the publishing workflow's logs.
 *
 *   npm run sombra -- [--dias 7] [--modelo gpt-6.1-terra]
 *
 * Uses the GitHub CLI already signed in for this repository (`gh run list`, `gh run view --log`),
 * so it needs no token of its own. Reads only; nothing is written.
 */

const run = promisify(execFile);
const WORKFLOW = "publicar.yml";
const MAX_DAYS = 30;
const LOG_BYTES = 64 * 1024 * 1024;

function argValue(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  return argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function parseDays(): number {
  const raw = argValue("--dias");
  if (raw === undefined) return 7;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new Error(`--dias precisa ser um inteiro de 1 a ${MAX_DAYS}`);
  return days;
}

async function gh(args: string[]): Promise<string> {
  try {
    const { stdout } = await run("gh", args, { cwd: repoRoot(), maxBuffer: LOG_BYTES, timeout: 120_000 });
    return stdout;
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new Error(`gh ${args.slice(0, 2).join(" ")} falhou: ${reason}`, { cause: error });
  }
}

async function main(): Promise<void> {
  const days = parseDays();
  const model = argValue("--modelo");
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const listed = JSON.parse(
    await gh(["run", "list", "--workflow", WORKFLOW, "--limit", "200", "--json", "databaseId,createdAt,event,conclusion"])
  ) as Array<{ databaseId: number; createdAt: string; event: string; conclusion: string }>;
  // A push only rebuilds the site; the kitchen, and so the search, runs on schedule and dispatch.
  const runs = listed.filter((entry) => entry.event !== "push" && Date.parse(entry.createdAt) >= since);

  const collected: ShadowLogReport[] = [];
  let unreadable = 0;
  let withoutLog = 0;
  await mapLimit(runs, 4, async (entry) => {
    try {
      const parsed = parseShadowReports(await gh(["run", "view", String(entry.databaseId), "--log"]));
      collected.push(...parsed.reports);
      unreadable += parsed.unreadable;
    } catch {
      withoutLog += 1;
    }
  });

  const reports = latestPerEdition(collected).filter((report) => !model || report.model === model);
  process.stdout.write(`${renderShadowSummary(summarizeShadow(reports), { days, model })}\n`);
  if (runs.length === 0) process.stdout.write(`\nNenhuma corrida de ${WORKFLOW} nos últimos ${days} dias.\n`);
  if (unreadable) process.stdout.write(`\n${unreadable} linha(s) da sombra não puderam ser lidas.\n`);
  if (withoutLog) process.stdout.write(`\n${withoutLog} corrida(s) sem log disponível (log expirado ou sem acesso).\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
