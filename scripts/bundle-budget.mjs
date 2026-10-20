#!/usr/bin/env node
/**
 * Fails when the cover's critical bundle grows past its budget.
 *
 * The README treats the cover's gzip size as a property that matters — the charts library was
 * split out precisely to protect it. Nothing enforced that, so the number could regress and only
 * be noticed by a reader on a slow connection.
 *
 * "Critical" is defined operationally, not by taste: the entry chunk plus everything reachable
 * through its **static** imports, plus their CSS. `dynamicImports` are deliberately NOT followed,
 * because a lazily-loaded route (the charts, the search index) is exactly what does not land on
 * the cover — following them would measure the whole app and make the budget meaningless.
 *
 *   node scripts/bundle-budget.mjs           # measure and compare
 *   node scripts/bundle-budget.mjs --write   # record the current size as the new baseline
 *
 * Reads `frontend/dist/.vite/manifest.json`, so it runs after the frontend build and does not
 * depend on the site-assembly step.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(repoRoot, "frontend", "dist");
const manifestPath = path.join(distDir, ".vite", "manifest.json");
const budgetsPath = path.join(repoRoot, "budgets.json");

/**
 * Resolves the critical file set from a Vite manifest.
 *
 * Exported so the walk is unit-testable without a real build: getting `dynamicImports` wrong is
 * the one mistake that would quietly turn this gate into decoration.
 */
export function criticalFiles(manifest) {
  const entryKeys = Object.entries(manifest)
    .filter(([, chunk]) => chunk.isEntry)
    .map(([key]) => key);

  if (entryKeys.length === 0) {
    throw new Error("no entry chunk in manifest — is build.manifest enabled in vite.config.ts?");
  }

  const visited = new Set();
  const files = new Set();

  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk) return;
    if (chunk.file) files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    // Static imports only. dynamicImports are the lazy routes and must stay out.
    for (const imported of chunk.imports ?? []) visit(imported);
  }

  for (const key of entryKeys) visit(key);
  return [...files].sort();
}

/** gzip size of one built file, in bytes. */
export function gzipSizeOf(dir, file) {
  return gzipSync(readFileSync(path.join(dir, file)), { level: 9 }).length;
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

/** Budget from a measurement: 5% headroom, rounded up to the next whole kB. */
export function budgetFromMeasured(measuredBytes) {
  return Math.ceil((measuredBytes * 1.05) / 1024) * 1024;
}

function main() {
  if (!existsSync(manifestPath)) {
    throw new Error(
      `${path.relative(repoRoot, manifestPath)} missing — run \`npm run build --workspace=frontend\` first`
    );
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const files = criticalFiles(manifest);
  const sizes = files.map((file) => ({ file, bytes: gzipSizeOf(distDir, file) }));
  const measured = sizes.reduce((total, entry) => total + entry.bytes, 0);

  process.stdout.write(`bundle crítico — ${files.length} arquivo(s), ${formatKb(measured)} gzip\n`);
  for (const { file, bytes } of sizes) {
    process.stdout.write(`  ${formatKb(bytes).padStart(9)}  ${file}\n`);
  }

  if (process.argv.includes("--write")) {
    const budget = budgetFromMeasured(measured);
    const budgets = existsSync(budgetsPath) ? JSON.parse(readFileSync(budgetsPath, "utf8")) : {};
    budgets.criticalBundleGzipBytes = {
      budget,
      measured,
      measuredAt: new Date().toISOString(),
      note:
        "Entry chunk plus its static import graph, gzip level 9. Dynamic imports (charts, search) " +
        "are excluded on purpose. Raise this only with a reason — the cover is a scanning surface.",
    };
    writeFileSync(budgetsPath, `${JSON.stringify(budgets, null, 2)}\n`);
    process.stdout.write(
      `\nbaseline gravado em budgets.json: orçamento ${formatKb(budget)} (medido ${formatKb(measured)})\n`
    );
    return;
  }

  if (!existsSync(budgetsPath)) {
    throw new Error("budgets.json missing — run `node scripts/bundle-budget.mjs --write` once to set the baseline");
  }

  const budget = JSON.parse(readFileSync(budgetsPath, "utf8")).criticalBundleGzipBytes?.budget;
  if (typeof budget !== "number") {
    throw new Error("budgets.json has no numeric criticalBundleGzipBytes.budget");
  }

  if (measured > budget) {
    throw new Error(
      `bundle crítico estourou o orçamento: medido ${formatKb(measured)}, orçado ${formatKb(budget)} ` +
        `(+${formatKb(measured - budget)}). Mova o peso novo para um chunk carregado sob demanda, ` +
        `ou suba o orçamento em budgets.json com a justificativa no commit.`
    );
  }

  process.stdout.write(
    `\nok — medido ${formatKb(measured)}, orçado ${formatKb(budget)} ` +
      `(folga de ${formatKb(budget - measured)})\n`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
