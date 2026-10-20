/**
 * Rasterizes the journal Open Graph card.
 *
 * Edition covers are handled by rasterize-covers.mjs. This one is the card for sharing
 * `/pulso/` itself — a static SVG in frontend/public, written as PNG beside it so Vite
 * copies both into the site package.
 *
 * Usage: node scripts/rasterize-og.mjs   (wired into `npm run build:site`)
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundledFontFiles, rasterizeCoverSvg } from "./og-raster.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const svgPath = path.join(repoRoot, "frontend", "public", "og-pulso.svg");
const pngPath = path.join(repoRoot, "frontend", "public", "og-pulso.png");

if (!existsSync(svgPath)) {
  throw new Error(`missing ${path.relative(repoRoot, svgPath)}`);
}

function rendererMtimeMs() {
  const files = [path.join(here, "og-raster.mjs"), path.join(here, "rasterize-og.mjs"), ...bundledFontFiles()];
  return Math.max(...files.map((file) => statSync(file).mtimeMs));
}

const stale =
  !existsSync(pngPath) ||
  statSync(pngPath).mtimeMs < statSync(svgPath).mtimeMs ||
  statSync(pngPath).mtimeMs < rendererMtimeMs();

if (!stale) {
  process.stdout.write("rasterize-og: og-pulso.png is current\n");
  process.exit(0);
}

const png = rasterizeCoverSvg(readFileSync(svgPath, "utf8"));
writeFileSync(pngPath, png);
process.stdout.write(`rasterize-og: wrote ${path.relative(repoRoot, pngPath)} (${png.length} bytes)\n`);
