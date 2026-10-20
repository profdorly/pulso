/**
 * Writes the social card (PNG) of every published edition into the site.
 *
 * Social platforms do not render SVG, so the cover the kitchen draws as SVG is rasterized here,
 * at build time, and only the PNG is published: `<out>/editions/<date>/<name>.og.png`, the path
 * `og:image` points at. Only each edition's current cover is drawn — a republished edition's
 * older covers stay in the kitchen.
 *
 * Usage: node scripts/rasterize-covers.mjs [--out dist-site] [--editions <dir>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coverOgPath, rasterizeCoverSvg } from "./og-raster.mjs";
import { argValue, coverRelativePath, readPublicEditions, resolveEditionsDir } from "./lib/site-source.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(repoRoot, argValue("--out", "dist-site"));
const { dir: editionsDir } = resolveEditionsDir(repoRoot);
const { editions } = readPublicEditions(editionsDir);

let written = 0;
let bytes = 0;
for (const edition of editions) {
  const relative = coverRelativePath(edition);
  if (!relative) continue;
  const source = path.join(editionsDir, relative);
  if (!existsSync(source)) {
    process.stdout.write(`  aviso: capa ausente para ${edition.id}: ${relative}\n`);
    continue;
  }
  const target = path.join(outDir, "editions", coverOgPath(relative));
  const png = rasterizeCoverSvg(readFileSync(source, "utf8"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, png);
  written += 1;
  bytes += png.length;
}

process.stdout.write(
  `rasterize-covers: ${written} cover(s)` +
    (written > 0 ? `, ${(bytes / written / 1024).toFixed(1)} kB each on average\n` : "\n")
);
