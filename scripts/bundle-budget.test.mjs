import assert from "node:assert/strict";
import test from "node:test";
import { budgetFromMeasured, criticalFiles } from "./bundle-budget.mjs";

/**
 * Shape mirrors a real Vite manifest: keys are source paths, `file` is the hashed output.
 * The cover's entry statically imports a shared vendor chunk and lazily imports the charts.
 */
const manifest = {
  "index.html": {
    file: "assets/index-aaa.js",
    isEntry: true,
    css: ["assets/index-aaa.css"],
    imports: ["_vendor-bbb.js"],
    dynamicImports: ["src/components/pulso/ModelCharts.tsx"],
  },
  "_vendor-bbb.js": {
    file: "assets/vendor-bbb.js",
    imports: ["_shared-ccc.js"],
  },
  "_shared-ccc.js": {
    file: "assets/shared-ccc.js",
  },
  "src/components/pulso/ModelCharts.tsx": {
    file: "assets/ModelCharts-ddd.js",
    css: ["assets/ModelCharts-ddd.css"],
    imports: ["_recharts-eee.js"],
  },
  "_recharts-eee.js": {
    file: "assets/recharts-eee.js",
  },
};

test("follows the entry's static import graph, transitively", () => {
  const files = criticalFiles(manifest);
  assert.ok(files.includes("assets/index-aaa.js"));
  assert.ok(files.includes("assets/vendor-bbb.js"));
  // Reached only through vendor — a non-transitive walk would miss it and under-report.
  assert.ok(files.includes("assets/shared-ccc.js"));
});

test("includes the entry's CSS, which the reader also waits for", () => {
  assert.ok(criticalFiles(manifest).includes("assets/index-aaa.css"));
});

test("does NOT follow dynamic imports", () => {
  const files = criticalFiles(manifest);
  // The whole reason the charts were split out. Following these would measure the whole app
  // and the budget would stop meaning anything about the cover.
  assert.ok(!files.includes("assets/ModelCharts-ddd.js"));
  assert.ok(!files.includes("assets/ModelCharts-ddd.css"));
  assert.ok(!files.includes("assets/recharts-eee.js"));
});

test("survives a cycle between chunks instead of recursing forever", () => {
  const cyclic = {
    "index.html": { file: "a.js", isEntry: true, imports: ["_b.js"] },
    "_b.js": { file: "b.js", imports: ["index.html"] },
  };
  assert.deepEqual(criticalFiles(cyclic), ["a.js", "b.js"]);
});

test("refuses a manifest with no entry rather than reporting zero bytes", () => {
  assert.throws(() => criticalFiles({ "_x.js": { file: "x.js" } }), /no entry chunk/);
});

test("budget carries a small, explicit headroom", () => {
  // A wide budget would not hold a regression back; 5% rounded up to the next kB is enough
  // to absorb hash-length noise without absorbing a new dependency.
  assert.equal(budgetFromMeasured(100 * 1024), 105 * 1024);
  assert.ok(budgetFromMeasured(89_000) > 89_000);
});
