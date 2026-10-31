#!/usr/bin/env node
/**
 * Automated accessibility check over the PRERENDERED HTML, in CI, before merge.
 *
 * This is a public news site and nothing was checking it. The pages are already server-rendered
 * with their real content, so the markup a reader receives can be audited without a browser and
 * without a server: axe-core runs against jsdom over the files `npm run build:site` produced.
 *
 * DECLARED LIMIT — read this before trusting a green run. jsdom does no layout, so the rules that
 * need rendered pixels cannot run and are disabled by name below rather than left to fail in a
 * confusing way. Colour contrast is NOT verified here. The script prints what it could not check
 * on every run, because a gate that hides its own blind spot is worse than no gate: it converts
 * "unverified" into "verified" in the reader's mind. Covering contrast means a real browser
 * (Playwright + axe), which is the upgrade path — the interface of this script does not change.
 *
 *   node scripts/a11y.mjs [--dir dist-site]
 *
 * Fails on any violation of impact `serious` or `critical`.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { editionPath } from "./lib/edition-paths.mjs";
import { readPublicEditions, resolveEditionsDir } from "./lib/site-source.mjs";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argValue(flag, fallback) {
  const prefix = `${flag}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const siteDir = path.resolve(repoRoot, argValue("--dir", "dist-site"));

/** Rules that need layout, so jsdom cannot evaluate them. Named, not silently dropped. */
const RULES_NEEDING_LAYOUT = ["color-contrast", "color-contrast-enhanced"];

/** Impacts that block a merge. `minor` and `moderate` are reported but do not fail. */
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

function routesToAudit() {
  const routes = [
    { label: "capa", file: "index.html" },
    { label: "arquivo", file: path.join("arquivo", "index.html") },
    { label: "semana", file: path.join("semana", "index.html") },
    { label: "modelos", file: path.join("modelos", "index.html") },
    { label: "metodologia", file: path.join("metodologia", "index.html") },
    { label: "404", file: "404.html" },
  ];

  // Newest edition: the densest page, and the one that changes every run.
  const { latest } = readPublicEditions(resolveEditionsDir(repoRoot).dir);
  if (latest) {
    const route = editionPath(latest.calendarDate, latest.slot);
    routes.push({ label: `edição ${route.slice(1)}`, file: path.join(route.slice(1), "index.html") });
  }

  return routes.filter((route) => existsSync(path.join(siteDir, route.file)));
}

async function auditFile(file) {
  const html = readFileSync(path.join(siteDir, file), "utf8");

  // `outside-only` lets us inject axe from Node while keeping the page's own <script> tags inert.
  // The audit target is the server-rendered markup, not the hydrated app — and running the page's
  // scripts here would reach the network and audit a different document than a crawler sees.
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "https://pulso.dorly.com.br/",
    pretendToBeVisual: true,
  });

  dom.window.eval(axeSource);

  const rules = Object.fromEntries(RULES_NEEDING_LAYOUT.map((rule) => [rule, { enabled: false }]));
  const results = await dom.window.axe.run(dom.window.document, { rules });

  dom.window.close();
  return results;
}

async function main() {
  if (!existsSync(siteDir)) {
    throw new Error(`${path.relative(repoRoot, siteDir)} missing — run \`npm run build:site\` first`);
  }

  const routes = routesToAudit();
  if (routes.length === 0) {
    throw new Error(`no prerendered HTML found under ${path.relative(repoRoot, siteDir)}`);
  }

  const blocking = [];
  let incompleteTotal = 0;

  for (const route of routes) {
    const results = await auditFile(route.file);
    const failed = results.violations.filter((violation) => BLOCKING_IMPACTS.has(violation.impact));
    const lesser = results.violations.filter((violation) => !BLOCKING_IMPACTS.has(violation.impact));
    incompleteTotal += results.incomplete.length;

    const verdict = failed.length === 0 ? "ok" : `${failed.length} bloqueante(s)`;
    process.stdout.write(`${route.label}: ${verdict}`);
    process.stdout.write(lesser.length > 0 ? `, ${lesser.length} menor(es)\n` : "\n");

    for (const violation of failed) {
      blocking.push({ route: route.label, violation });
      process.stdout.write(`  [${violation.impact}] ${violation.id} — ${violation.help}\n`);
      for (const node of violation.nodes.slice(0, 3)) {
        process.stdout.write(`      ${node.target.join(" ")}\n`);
      }
    }
    for (const violation of lesser) {
      process.stdout.write(`  (${violation.impact}) ${violation.id} — ${violation.help}\n`);
    }
  }

  process.stdout.write(
    `\nnão verificado (exige layout, jsdom não renderiza): ${RULES_NEEDING_LAYOUT.join(", ")}\n` +
      `resultados inconclusivos, informativos: ${incompleteTotal}\n`
  );

  if (blocking.length > 0) {
    throw new Error(
      `${blocking.length} violação(ões) de acessibilidade com impacto serious/critical em ` +
        `${new Set(blocking.map((entry) => entry.route)).size} rota(s)`
    );
  }

  process.stdout.write(`ok — ${routes.length} rota(s) sem violação serious/critical\n`);
}

await main();
