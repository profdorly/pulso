/**
 * O Pulso da Semana, uma etapa por comando. O passo a passo para quem opera (pessoa ou agente de
 * IA) está em docs/pulso-da-semana.md.
 *
 *   npm run semana -- status                 onde a semana está e qual é o próximo passo
 *   npm run semana -- preparar               baixa as edições da cozinha (R2) para data/editions
 *   npm run semana -- roteiro [--refazer]    gera e checa o roteiro (OpenAI; nada de áudio)
 *   npm run semana -- checar [--revisar]     checa de novo um script.json editado à mão
 *   npm run semana -- aprovar                registra a aprovação humana do roteiro atual
 *   npm run semana -- audio                  gera, monta (1.15×) e verifica o áudio (ElevenLabs)
 *   npm run semana -- publicar [--dry-run]   envia ao R2 e pede o site novo ao GitHub
 *
 * Todas aceitam `--inicio AAAA-MM-DD` (a segunda-feira da semana). Sem ele, vale a última semana
 * completa: rodando numa segunda, a que terminou no domingo.
 *
 * As travas não dependem de quem opera seguir o roteiro: o áudio não roda sem uma aprovação do
 * script.json exato que está na pasta, e a publicação não roda com áudio de outra versão nem com
 * episódio acima de cinco minutos.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { stateTargetFromEnv } from "../kitchen/storage.js";
import { assertApproved, runAudio } from "./audioPilot.js";
import { arg, fileSha256, hasFlag, pilotDir, repoRoot, weekStartArg } from "./cli.js";
import { EPISODE_SPEED, MAX_EPISODE_SECONDS } from "./episodeFormat.js";
import { isoWeekId, loadWeek } from "./input.js";
import { callsTotal, formatUsd, readCalls } from "./ledger.js";
import { APPROVAL_FILE, recheckScript, runScript, type ScriptStatus } from "./pilot.js";
import { runVerify } from "./verify.js";

const SITE = "https://pulso.dorly.com.br";
const EDITIONS_DIR = path.join(repoRoot, "data/editions");
/** A 5,100-character script costs about that many credits at list rate; this leaves room for one retake. */
const DEFAULT_MAX_CREDITS = 6_500;

const command = process.argv[2];
let weekStart: string;
try {
  weekStart = weekStartArg();
} catch (error) {
  console.error(`erro: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
const weekId = isoWeekId(weekStart);
const dir = pilotDir(weekId);
const shown = (file: string) => path.relative(repoRoot, file);
const file = (name: string) => path.join(dir, name);

function readJson<T>(name: string): T | null {
  return existsSync(file(name)) ? (JSON.parse(readFileSync(file(name), "utf8")) as T) : null;
}

function run(cmd: string, args: string[], cwd = repoRoot): void {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} terminou com código ${result.status}`);
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)} min ${String(Math.round(seconds % 60)).padStart(2, "0")} s`;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

interface EpisodeFile {
  durationSeconds: number;
  title: string;
  audio: { path: string; bytes: number };
}

interface AudioStatus {
  scriptSha256: string | null;
  at: string;
}

function episodePaths() {
  const publicDir = path.join(dir, "public", "weekly");
  return { publicDir, episode: path.join(publicDir, weekId, "episode.json") };
}

function editionsOfWeek(): { ids: string[]; days: string[] } | null {
  if (!existsSync(path.join(EDITIONS_DIR, "index.json"))) return null;
  const input = loadWeek(EDITIONS_DIR, weekStart);
  return { ids: input.editionIds, days: [...new Set(input.editionIds.map((id) => id.slice(0, 10)))] };
}

function preparar(): void {
  if (!stateTargetFromEnv(process.env)) {
    throw new Error(
      "credenciais do R2 ausentes: defina R2_ACCOUNT_ID, R2_ACCESS_KEY_ID e R2_SECRET_ACCESS_KEY em backend/.env " +
        "(veja docs/pulso-da-semana.md, \"Preparação única\")"
    );
  }
  run("npm", ["run", "kitchen:export"], path.join(repoRoot, "backend"));
  const week = editionsOfWeek();
  const days = week?.days.length ?? 0;
  console.log(`\n${weekId} (${shortDate(weekStart)} a ${shortDate(loadWeek(EDITIONS_DIR, weekStart).to)}): ${days} de 7 dias com edição`);
  if (days === 0) throw new Error("nenhuma edição nesta semana; confira --inicio");
  if (days < 7) console.log("  aviso: semana incompleta; o episódio sai só com o que foi publicado");
  console.log("próximo passo: npm run semana -- roteiro");
}

async function roteiro(): Promise<void> {
  if (existsSync(file("script.json")) && !hasFlag("--refazer")) {
    throw new Error(
      `já existe um roteiro em ${shown(dir)}. Para gerar outro do zero (o atual é substituído e a aprovação cai), use --refazer; ` +
        "para checar uma edição feita à mão, use `checar`"
    );
  }
  const passed = await runScript(weekStart, { editionsDir: EDITIONS_DIR });
  console.log(passed ? `\nleia: ${shown(file("script.txt"))}` : "\nveja os apontamentos acima; edite script.json e rode `checar`, ou `roteiro --refazer`");
  if (!passed) process.exitCode = 1;
}

async function checar(): Promise<void> {
  const passed = await recheckScript(weekStart, { weekId, revise: hasFlag("--revisar") });
  if (!passed) process.exitCode = 1;
}

function aprovar(): void {
  const status = readJson<Partial<ScriptStatus>>("script-status.json");
  const current = fileSha256(file("script.json"));
  if (!status || !current) throw new Error("não há roteiro checado para aprovar; rode `roteiro`");
  if (!status.passed) throw new Error("o roteiro não passou nas checagens e não pode ser aprovado");
  if (status.scriptSha256 !== current) throw new Error("script.json mudou depois da checagem; rode `checar` antes de aprovar");
  const approval = { scriptSha256: current, approvedAt: new Date().toISOString(), approvedBy: userInfo().username };
  writeFileSync(file(APPROVAL_FILE), `${JSON.stringify(approval, null, 2)}\n`);
  console.log(`roteiro de ${weekId} aprovado por ${approval.approvedBy}. Próximo passo: npm run semana -- audio`);
}

async function audio(): Promise<void> {
  assertApproved(dir);
  const scriptSha256 = fileSha256(file("script.json"));
  // A transcript check of an earlier audio would read as a check of this one.
  rmSync(file("verify.json"), { force: true });
  rmSync(file("audio-status.json"), { force: true });
  await runAudio(weekId, { maxCredits: Number(arg("--max-creditos", String(DEFAULT_MAX_CREDITS))) });
  const status: AudioStatus = { scriptSha256, at: new Date().toISOString() };
  writeFileSync(file("audio-status.json"), `${JSON.stringify(status, null, 2)}\n`);
  if (!hasFlag("--sem-verificar")) {
    console.log("\nverificando: transcrição do áudio comparada com o roteiro");
    const verdict = await runVerify(weekId);
    console.log(
      verdict.flagged === 0
        ? `verificação limpa (maior diferença por bloco: ${verdict.worstWordErrorRate}%)`
        : `ATENÇÃO: ${verdict.flagged} trecho(s) para ouvir com cuidado; veja ${shown(file("verify.json"))}`
    );
  }
  const episode = JSON.parse(readFileSync(episodePaths().episode, "utf8")) as EpisodeFile;
  const mp3 = path.join(episodePaths().publicDir, episode.audio.path.replace(/^weekly\//, ""));
  console.log(`\nepisódio: ${clock(episode.durationSeconds)} a ${EPISODE_SPEED}× → ${shown(mp3)}`);
  console.log("próximo passo: ouvir e, com o ok da pessoa responsável, npm run semana -- publicar");
}

function publicar(): void {
  const { publicDir, episode: episodeFile } = episodePaths();
  if (!existsSync(episodeFile)) throw new Error("não há episódio montado; rode `audio`");
  assertApproved(dir);
  const audioStatus = readJson<AudioStatus>("audio-status.json");
  if (!audioStatus || audioStatus.scriptSha256 !== fileSha256(file("script.json"))) {
    throw new Error("o áudio foi gerado de outra versão do roteiro; rode `audio` de novo");
  }
  const episode = JSON.parse(readFileSync(episodeFile, "utf8")) as EpisodeFile;
  if (episode.durationSeconds > MAX_EPISODE_SECONDS && !hasFlag("--forcar")) {
    throw new Error(`o episódio tem ${clock(episode.durationSeconds)}, acima de ${MAX_EPISODE_SECONDS / 60} min; encurte o roteiro (ou --forcar)`);
  }
  const dryRun = hasFlag("--dry-run");
  run("npm", ["run", "kitchen:weekly", "--", "--from", publicDir, ...(dryRun ? ["--dry-run"] : [])], path.join(repoRoot, "backend"));
  if (dryRun) return;

  writeFileSync(file("published.json"), `${JSON.stringify({ weekId, publishedAt: new Date().toISOString(), audio: episode.audio.path }, null, 2)}\n`);
  if (hasFlag("--sem-site")) {
    console.log("episódio no R2; o site o mostra na próxima publicação (ou: gh workflow run publicar.yml -f tarefa=site)");
    return;
  }
  run("gh", ["workflow", "run", "publicar.yml", "--ref", "main", "-f", "tarefa=site"]);
  console.log(
    `\nsite pedido ao GitHub. Acompanhe com \`gh run watch\` (leva uns 3 minutos) e confira ${SITE}/semana/${weekId}/`
  );
}

function status(): void {
  const lines: string[] = [];
  let next: string | null = null;
  const nextIf = (step: string) => (next ??= step);

  const week = editionsOfWeek();
  const scriptSha = fileSha256(file("script.json"));
  lines.push(`Pulso da Semana ${weekId}, semana de ${shortDate(weekStart)} (pasta ${shown(dir)})`);
  // The editions only matter before the script exists: after that, the script is the input.
  if (!week) {
    lines.push("edições: não baixadas");
    if (!scriptSha) nextIf("npm run semana -- preparar");
  } else {
    lines.push(`edições: ${week.days.length} de 7 dias em data/editions`);
    if (week.days.length === 0 && !scriptSha) nextIf("npm run semana -- preparar");
  }

  const scriptStatus = readJson<Partial<ScriptStatus>>("script-status.json");
  if (!scriptSha || !scriptStatus) {
    lines.push("roteiro: não gerado");
    nextIf("npm run semana -- roteiro");
  } else if (scriptStatus.scriptSha256 !== scriptSha) {
    lines.push("roteiro: editado depois da última checagem");
    nextIf("npm run semana -- checar");
  } else if (!scriptStatus.passed) {
    lines.push(`roteiro: reprovado (${(scriptStatus.findings?.length ?? 0) + (scriptStatus.problems?.length ?? 0)} apontamento(s))`);
    nextIf("corrigir script.json e rodar `npm run semana -- checar`, ou `roteiro --refazer`");
  } else {
    lines.push(`roteiro: passou nas checagens → ${shown(file("script.txt"))}`);
  }

  const approval = readJson<{ scriptSha256?: string; approvedAt?: string; approvedBy?: string }>(APPROVAL_FILE);
  if (scriptSha && scriptStatus?.passed && scriptStatus.scriptSha256 === scriptSha) {
    if (!approval) {
      lines.push("aprovação: pendente");
      nextIf("a pessoa responsável lê script.txt e diz se aprova; só então `npm run semana -- aprovar`");
    } else if (approval.scriptSha256 !== scriptSha) {
      lines.push("aprovação: de outra versão do roteiro");
      nextIf("a pessoa responsável lê o roteiro atual; só então `npm run semana -- aprovar`");
    } else {
      lines.push(`aprovação: ${approval.approvedBy ?? "?"} em ${approval.approvedAt ?? "?"}`);
    }
  }

  const audioStatus = readJson<AudioStatus>("audio-status.json");
  const report = readJson<{ durationSeconds: number; overLimit?: boolean }>("audio-report.json");
  if (!audioStatus || !report) {
    lines.push("áudio: não gerado");
    nextIf("npm run semana -- audio");
  } else if (audioStatus.scriptSha256 !== scriptSha) {
    lines.push("áudio: de outra versão do roteiro");
    nextIf("npm run semana -- audio");
  } else {
    lines.push(`áudio: ${clock(report.durationSeconds)} a ${EPISODE_SPEED}×${report.overLimit ? " — ACIMA DE 5 MIN" : ""}`);
  }

  const verify = readJson<Array<{ wordErrorRate: number; skipped: string[]; added: string[]; tagWordsHeard: string[] }>>("verify.json");
  if (verify && audioStatus?.scriptSha256 === scriptSha) {
    const flagged = verify.reduce((n, v) => n + v.skipped.length + v.added.length + v.tagWordsHeard.length, 0);
    lines.push(`verificação: maior diferença ${Math.max(...verify.map((v) => v.wordErrorRate))}%, ${flagged} alerta(s)`);
  }

  const published = readJson<{ publishedAt: string }>("published.json");
  lines.push(published ? `publicado: ${published.publishedAt} → ${SITE}/semana/${weekId}/` : "publicado: não");
  if (!published) nextIf("ouvir o episódio e, com o ok da pessoa responsável, `npm run semana -- publicar`");

  const { usd, unpriced } = callsTotal(readCalls(dir));
  const credits = readJson<{ billed?: number }>("credits.json");
  lines.push(
    `custo: texto ${formatUsd(usd)}${unpriced.length ? ` (+ sem preço: ${unpriced.join(", ")})` : ""}, ` +
      `voz ${credits?.billed ?? 0} créditos ElevenLabs`
  );
  lines.push(`próximo passo: ${next ?? "nenhum; a semana está publicada"}`);
  console.log(lines.join("\n"));
}

const commands: Record<string, () => void | Promise<void>> = { status, preparar, roteiro, checar, aprovar, audio, publicar };
const handler = command ? commands[command] : undefined;
if (!handler) {
  console.error(`uso: npm run semana -- <${Object.keys(commands).join("|")}> [--inicio AAAA-MM-DD]`);
  process.exitCode = 2;
} else {
  try {
    await handler();
  } catch (error) {
    console.error(`\nerro: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
