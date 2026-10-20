#!/usr/bin/env node
/**
 * Does the live site show what the kitchen holds? The check that matters to a reader: a run can
 * succeed while the site stays on yesterday (a failed deploy, a skipped build).
 *
 * Reads the `pulso:edition` marker the prerender writes into the home page and compares it with
 * the edition expected. Exit 0 when they match, 1 when they do not (after waiting, if asked).
 *
 * Usage: node scripts/site-live.mjs --edition 2026-10-19-manha [--wait 600] [--origin https://…]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { argValue } from "./lib/site-source.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function liveEditionOf(html) {
  return /<meta name="pulso:edition" content="([^"]+)"/.exec(html)?.[1] ?? null;
}

function siteOrigin() {
  const source = readFileSync(path.join(repoRoot, "frontend", "src", "lib", "siteBase.ts"), "utf8");
  const origin = /SITE_ORIGIN\s*=\s*"([^"]+)"/.exec(source)?.[1];
  if (!origin) throw new Error("SITE_ORIGIN não encontrado em siteBase.ts");
  return origin;
}

async function fetchLive(origin) {
  // A query string past the CDN's copy of the page: the check must see what was just deployed.
  const url = `${origin.replace(/\/$/, "")}/?verificacao=${Date.now()}`;
  const response = await fetch(url, { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} em ${origin}`);
  return liveEditionOf(await response.text());
}

async function main() {
  const expected = argValue("--edition", null);
  if (!expected) throw new Error("faltou --edition");
  const origin = argValue("--origin", null) ?? siteOrigin();
  const deadline = Date.now() + Number(argValue("--wait", "0")) * 1000;

  for (;;) {
    let live = null;
    let problem = "";
    try {
      live = await fetchLive(origin);
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
    if (live === expected) {
      process.stdout.write(`no ar: ${live}\n`);
      return;
    }
    if (Date.now() >= deadline) {
      process.stdout.write(`fora do ar: esperado ${expected}, o site mostra ${live ?? "nada"}${problem ? ` (${problem})` : ""}\n`);
      process.exitCode = 1;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
