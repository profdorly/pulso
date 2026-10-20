import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Resvg } from "@resvg/resvg-js";
import {
  COVER_OG_IMAGE_SUFFIX,
  MIN_LIGHT_FRACTION,
  coverOgPath,
  decodePng,
  pngLightStats,
  rasterizeCoverSvg,
  resvgFontOptions,
  stripCoverGrain,
  toPalettePng,
} from "./og-raster.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureSvg = path.join(repoRoot, "fixtures", "editions", "2026-10-10", "manha.cover-r1.svg");

describe("coverOgPath", () => {
  it("replaces the svg suffix with the cache-busting og name", () => {
    assert.equal(coverOgPath("manha.cover-r1.svg"), `manha.cover-r1${COVER_OG_IMAGE_SUFFIX}`);
    assert.equal(COVER_OG_IMAGE_SUFFIX, ".og.png");
  });
});

describe("stripCoverGrain", () => {
  it("drops the turbulence filter so the share PNG is not 1MB of noise", () => {
    const svg = readFileSync(fixtureSvg, "utf8");
    const stripped = stripCoverGrain(svg);
    assert.equal(stripped.includes("grainFilter"), false);
    assert.equal(stripped.includes("feTurbulence"), false);
    assert.equal(stripped.includes("Chips para IA"), true);
  });
});

describe("rasterizeCoverSvg", () => {
  it("paints type on a Georgia cover without using host fonts", () => {
    const svg = readFileSync(fixtureSvg, "utf8");
    const png = rasterizeCoverSvg(svg);
    const stats = pngLightStats(png);
    assert.equal(stats.width, 1200);
    assert.equal(stats.height, 675);
    assert.ok(
      stats.lightFraction >= MIN_LIGHT_FRACTION,
      `light fraction ${stats.lightFraction} below ${MIN_LIGHT_FRACTION}`
    );
  });

  it("rejects a black raster the way Lambda used to publish", () => {
    assert.throws(
      () =>
        rasterizeCoverSvg(`<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675">
  <rect width="100%" height="100%" fill="#14110c"/>
  <circle cx="168" cy="596" r="2" fill="#e07a3d"/>
</svg>`),
      /no painted type/
    );
  });

  it("writes an indexed PNG a fraction of the RGBA size, with the same picture", () => {
    const svg = readFileSync(fixtureSvg, "utf8");
    const rgba = new Resvg(stripCoverGrain(svg), { fitTo: { mode: "original" }, font: resvgFontOptions() }).render().asPng();
    const indexed = rasterizeCoverSvg(svg);

    assert.equal(indexed[25], 3, "colour type 3: indexed");
    assert.ok(indexed.length < rgba.length / 2, `${indexed.length} bytes vs ${rgba.length}`);
    const before = decodePng(rgba);
    const after = decodePng(indexed);
    let total = 0;
    for (let i = 0; i < before.width * before.height; i += 1) {
      for (let c = 0; c < 3; c += 1) total += Math.abs(before.data[i * before.channels + c] - after.data[i * 3 + c]);
    }
    assert.ok(total / (before.width * before.height * 3) < 0.1, "mean channel error stays under 0.1 of 255");
  });

  it("keeps an image of 256 colours or fewer exact", () => {
    const flat = new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"><rect width="2" height="2" fill="#123456"/><rect x="2" width="2" height="2" fill="#fbf7f2"/></svg>`
    )
      .render()
      .asPng();
    const { data } = decodePng(toPalettePng(flat));
    assert.deepEqual([...data.subarray(0, 3)], [0x12, 0x34, 0x56]);
    assert.deepEqual([...data.subarray(9, 12)], [0xfb, 0xf7, 0xf2]);
  });
});
