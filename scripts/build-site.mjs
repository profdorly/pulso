#!/usr/bin/env node
/**
 * Starts the deployable site: the built reader, plus the weekly audio's files when there is an
 * episode. Pages are written next by `prerender.mjs`, social cards by `rasterize-covers.mjs`.
 *
 *   <out>/index.html          the reader shell, which prerender turns into every page
 *   <out>/assets/*            hashed CSS, and the script only the weekly audio loads
 *   <out>/editions/weekly/*   the weekly audio (episode JSON and MP3), when published
 *
 * Edition JSON is not published: every page is rendered from it at build time, and nothing in the
 * browser reads it. The Vite manifest stays out too; only `bundle-budget.mjs` reads it, from
 * frontend/dist.
 *
 * Usage: node scripts/build-site.mjs [--out dist-site] [--editions <dir>] [--weekly <dir>]
 */

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { argValue, resolveEditionsDir, resolveWeeklyDir } from "./lib/site-source.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(repoRoot, argValue("--out", "dist-site"));
const readerDist = path.join(repoRoot, "frontend", "dist");

if (!existsSync(path.join(readerDist, "index.html"))) {
  throw new Error("frontend/dist/index.html is missing — run `npm run build --workspace=frontend` first");
}

const { dir: editionsDir, source } = resolveEditionsDir(repoRoot);
const weeklyDir = resolveWeeklyDir(repoRoot, editionsDir);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(readerDist, outDir, {
  recursive: true,
  // The Vite manifest is read from frontend/dist; og-pulso.svg is only the source of og-pulso.png.
  filter: (from) => ![".vite", "og-pulso.svg"].includes(path.basename(from)),
});

if (weeklyDir) {
  cpSync(weeklyDir, path.join(outDir, "editions", "weekly"), { recursive: true });
}

process.stdout.write(
  `site started at ${path.relative(repoRoot, outDir)}\n` +
    `  reader: frontend/dist\n` +
    `  editions read from: ${source}\n` +
    `  weekly: ${weeklyDir ? path.relative(repoRoot, weeklyDir) : "none"}\n`
);
