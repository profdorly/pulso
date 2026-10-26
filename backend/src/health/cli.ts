import dotenv from "dotenv";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../edition/paths.js";
import { collectCloudflare } from "./cloudflare.js";
import { resolveSettings, secretValues } from "./config.js";
import { collectGithub } from "./github.js";
import { collectHealthchecks } from "./healthchecks.js";
import { renderHealthPage, type HealthSnapshot } from "./render.js";
import { collect, type Source } from "./source.js";

/**
 * The local health and cost panel. Usage:
 *
 *   npm run health -- [--days 30] [--out .tmp/health]
 *
 * Reads GitHub Actions (runs and the kitchen's run reports), Healthchecks.io and Cloudflare with
 * read-only credentials from `.env.health` (see `.env.health.example`), and writes a static
 * `index.html` plus the `snapshot.json` it was drawn from. Sources left unconfigured show as such.
 */

/** The site's own fonts (frontend/public/fonts), inlined: the page has no server to load them from. */
const FONTS: Array<[family: string, weight: number, file: string]> = [
  ["Playfair Display", 500, "playfair-display-500-latin.woff2"],
  ["IBM Plex Sans", 400, "ibm-plex-sans-400-latin.woff2"],
  ["IBM Plex Sans", 600, "ibm-plex-sans-600-latin.woff2"],
  ["IBM Plex Mono", 500, "ibm-plex-mono-500-latin.woff2"],
];

function fontCss(root: string): string {
  return FONTS.map(([family, weight, file]) => {
    const full = path.join(root, "frontend", "public", "fonts", file);
    if (!existsSync(full)) return "";
    const data = readFileSync(full).toString("base64");
    return `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${data}) format('woff2')}`;
  }).join("");
}

function readIfExists(file: string): string | undefined {
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

/** Output of a local command, or undefined when it is missing or fails. No shell involved. */
function run(command: string, args: string[], cwd: string): string | undefined {
  try {
    return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim();
  } catch {
    return undefined;
  }
}

function describe(name: string, source: Source<unknown>): string {
  if (source.state === "ok") return `${name}: ok`;
  if (source.state === "missing") return `${name}: não configurado (${source.missing.join(", ")})`;
  return `${name}: erro — ${source.message}`;
}

async function main(): Promise<void> {
  const root = repoRoot();
  const envText = readIfExists(path.join(root, ".env.health"));
  const settings = resolveSettings({
    argv: process.argv.slice(2),
    env: process.env,
    envFile: envText ? dotenv.parse(envText) : {},
    wrangler: readIfExists(path.join(root, "infra", "disparador", "wrangler.jsonc")),
    remote: run("git", ["remote", "get-url", "origin"], root),
    ghToken: () => run("gh", ["auth", "token"], root),
    root,
    // npm runs workspace scripts from the workspace folder; --out is relative to where it was typed.
    cwd: process.env.INIT_CWD ?? process.cwd(),
  });
  const secrets = secretValues(settings);
  const now = new Date();
  const since = new Date(now.getTime() - settings.days * 24 * 60 * 60 * 1000);
  const { github, healthchecks, cloudflare } = settings;

  const [githubSource, healthchecksSource, cloudflareSource] = await Promise.all([
    collect(
      [
        ...(github.token ? [] : ["PULSO_HEALTH_GITHUB_TOKEN (ou gh auth login)"]),
        ...(github.repo ? [] : ["PULSO_HEALTH_REPO"]),
      ],
      secrets,
      () => collectGithub({ repo: github.repo!, token: github.token!, since })
    ),
    collect(healthchecks.apiKey ? [] : ["PULSO_HEALTH_HEALTHCHECKS_KEY"], secrets, () =>
      collectHealthchecks({ apiKey: healthchecks.apiKey! })
    ),
    collect(
      [
        ...(cloudflare.accountId ? [] : ["PULSO_HEALTH_CLOUDFLARE_ACCOUNT_ID"]),
        ...(cloudflare.token ? [] : ["PULSO_HEALTH_CLOUDFLARE_TOKEN"]),
        ...(cloudflare.worker ? [] : ["PULSO_HEALTH_WORKER"]),
      ],
      secrets,
      () =>
        collectCloudflare({
          accountId: cloudflare.accountId!,
          token: cloudflare.token!,
          worker: cloudflare.worker!,
          crons: cloudflare.crons,
          from: since,
          to: now,
        })
    ),
  ]);

  const snapshot: HealthSnapshot = {
    generatedAt: now.toISOString(),
    since: since.toISOString(),
    days: settings.days,
    github: githubSource,
    healthchecks: healthchecksSource,
    cloudflare: cloudflareSource,
  };

  mkdirSync(settings.outDir, { recursive: true });
  const page = path.join(settings.outDir, "index.html");
  writeFileSync(page, renderHealthPage(snapshot, { fontCss: fontCss(root) }));
  writeFileSync(path.join(settings.outDir, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`);

  for (const line of [
    describe("GitHub", githubSource),
    describe("Healthchecks.io", healthchecksSource),
    describe("Cloudflare", cloudflareSource),
  ]) {
    process.stdout.write(`${line}\n`);
  }
  process.stdout.write(`painel: ${page}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
