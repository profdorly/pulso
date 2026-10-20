/**
 * Prerender end to end: what it writes, where, and what each page ships.
 *
 * The test builds the SSR bundle from the current sources into a scratch directory (never the
 * developer's `frontend/dist-ssr`), runs the real `prerender.mjs` over a small kitchen made from
 * the tracked fixtures — plus one edition in the old twice-daily format, which must not be
 * published — and reads what it wrote. It runs twice: without a weekly episode, every page is
 * static; with one, the cover and the episode page hydrate. The scratch directory sits inside the
 * repo (`.tmp/`, gitignored) because the bundle resolves react from the workspace's node_modules.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://pulso.dorly.com.br";
const fixtures = path.join(repoRoot, "fixtures", "editions");

/** The shell as Vite emits it: the reader bundle, a module preload and the stylesheet. */
const TEMPLATE = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>Pulso</title>
    <meta name="robots" content="noindex, nofollow" />
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-abc.js">
    <link rel="stylesheet" crossorigin href="/assets/index-abc.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

const latest = JSON.parse(readFileSync(path.join(fixtures, "latest.json"), "utf8"));
const older = JSON.parse(readFileSync(path.join(fixtures, "2026-10-09", "manha.json"), "utf8"));

let work = "";
let ssrEntry = "";

function run(name, { weekly }) {
  const kitchen = path.join(work, `${name}-kitchen`);
  const site = path.join(work, `${name}-site`);
  cpSync(fixtures, kitchen, { recursive: true });

  // An edition of the twice-daily period: in the index, with its file, and still not published.
  const legacy = { ...older, id: "2026-10-08-tarde", slot: "tarde", calendarDate: "2026-10-08", number: 90 };
  mkdirSync(path.join(kitchen, "2026-10-08"), { recursive: true });
  writeFileSync(path.join(kitchen, "2026-10-08", "tarde.json"), JSON.stringify(legacy));
  const index = JSON.parse(readFileSync(path.join(kitchen, "index.json"), "utf8"));
  index.editions.push({
    id: legacy.id,
    slot: "tarde",
    calendarDate: "2026-10-08",
    capturedAt: "2026-10-08T19:31:00.000Z",
    number: 90,
    headline: "Uma edição do formato antigo",
    path: "/2026-10-08/tarde/",
  });
  writeFileSync(path.join(kitchen, "index.json"), JSON.stringify(index));

  if (weekly) {
    const episodeDir = path.join(kitchen, "weekly", "2026-W41");
    mkdirSync(episodeDir, { recursive: true });
    writeFileSync(
      path.join(kitchen, "weekly", "index.json"),
      JSON.stringify({
        schemaVersion: 1,
        latestId: "2026-W41",
        episodes: [{ weekId: "2026-W41", title: "A semana em IA", description: "Episódio de teste.", path: "weekly/2026-W41/episode.json" }],
      })
    );
    writeFileSync(
      path.join(episodeDir, "episode.json"),
      JSON.stringify({
        sources: [
          { ref: "s1", title: "Uma matéria antiga", outlet: "Revista Exemplo", url: "https://tech.example.net/antiga", itemPath: "2026-09-30/tarde/noticia/abc" },
          { ref: "s2", title: "Uma matéria diária", outlet: "Jornal Exemplo", url: "https://noticias.example.org/diaria", itemPath: "2026-10-10/manha/noticia/def" },
        ],
      })
    );
  }

  mkdirSync(site, { recursive: true });
  writeFileSync(path.join(site, "index.html"), TEMPLATE);
  const result = spawnSync(
    process.execPath,
    ["scripts/prerender.mjs", "--dir", site, "--ssr", ssrEntry, "--editions", kitchen],
    { cwd: repoRoot, encoding: "utf8", env: { ...process.env, PULSO_WEEKLY_DIR: "" } }
  );
  assert.equal(result.status, 0, `prerender failed:\n${result.stdout}\n${result.stderr}`);
  return (relative) => readFileSync(path.join(site, relative), "utf8");
}

const canonicalOf = (html) => /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];

let plain;
let withWeekly;

before(() => {
  mkdirSync(path.join(repoRoot, ".tmp"), { recursive: true });
  work = mkdtempSync(path.join(repoRoot, ".tmp", "prerender-test-"));
  const ssrDir = path.join(work, "ssr");
  const vite = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, "node_modules", "vite", "bin", "vite.js"),
      "build",
      "--ssr",
      "src/entry-server.tsx",
      "--outDir",
      ssrDir,
      "--emptyOutDir",
      "--logLevel",
      "error",
    ],
    { cwd: path.join(repoRoot, "frontend"), encoding: "utf8" }
  );
  assert.equal(vite.status, 0, `SSR build failed:\n${vite.stdout}\n${vite.stderr}`);
  ssrEntry = path.join(ssrDir, "entry-server.js");

  plain = run("plain", { weekly: false });
  withWeekly = run("weekly", { weekly: true });
});

after(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe("prerender", () => {
  it("writes each daily edition at its date, as a complete page with no script", () => {
    const html = plain("2026-10-10/index.html");
    assert.equal(canonicalOf(html), `${ORIGIN}/2026-10-10/`);
    assert.match(html, /<meta property="og:url" content="https:\/\/pulso\.dorly\.com\.br\/2026-10-10\/" \/>/);
    assert.match(html, /<h1[^>]*>[^<]{10,}<\/h1>/);
    assert.doesNotMatch(html, /type="module"|rel="modulepreload"|id="pulso-data"/);
    assert.match(html, /rel="stylesheet"/);
  });

  it("links each item to the original reporting, with an anchor and no item page", () => {
    const html = plain("2026-10-10/index.html");
    for (const item of latest.items) {
      assert.match(html, new RegExp(`id="n-${item.id.slice(0, 10)}"`));
      assert.ok(html.includes(`href="${item.url}"`), item.url);
    }
    assert.doesNotMatch(html, /href="[^"]*\/noticia\//);
    assert.equal(existsSync(path.join(work, "plain-site", "2026-10-10", "noticia")), false);
  });

  it("does not publish an edition of the old twice-daily format, nor list it", () => {
    assert.equal(existsSync(path.join(work, "plain-site", "2026-10-08")), false);
    assert.doesNotMatch(plain("arquivo/index.html"), /2026-10-08|formato antigo/);
    assert.doesNotMatch(plain("feed.xml"), /2026-10-08/);
  });

  it("links every page at its served address, with the trailing slash", () => {
    assert.match(plain("index.html"), /href="\/2026-10-10\/"[^>]*>Abrir edição completa/);
    assert.match(plain("arquivo/index.html"), /href="\/2026-10-09\/"/);
    assert.match(plain("2026-10-10/index.html"), /href="\/2026-10-09\/"[^>]*>Edição anterior/);
    assert.match(plain("2026-10-09/index.html"), /href="\/2026-10-10\/"[^>]*>← Edição mais recente/);

    const feed = plain("feed.xml");
    assert.match(feed, /<link>https:\/\/pulso\.dorly\.com\.br\/2026-10-10\/<\/link>/);
    assert.match(feed, /<link>https:\/\/pulso\.dorly\.com\.br\/2026-10-09\/<\/link>/);
  });

  it("indexes only the pages that do not age", () => {
    const sitemap = plain("sitemap.xml");
    for (const loc of ["/", "/arquivo/", "/modelos/", "/metodologia/"]) {
      assert.ok(sitemap.includes(`<loc>${ORIGIN}${loc}</loc>`), loc);
    }
    assert.doesNotMatch(sitemap, /\d{4}-\d{2}-\d{2}\//);
  });

  it("publishes no edition data and no item pages", () => {
    const site = path.join(work, "plain-site");
    assert.equal(existsSync(path.join(site, "editions", "index.json")), false);
    assert.equal(existsSync(path.join(site, "editions", "latest.json")), false);
    assert.equal(existsSync(path.join(site, "redirect.js")), false);
  });

  it("ships the cover as a static page when there is no weekly episode", () => {
    assert.doesNotMatch(plain("index.html"), /type="module"|id="pulso-data"/);
    assert.doesNotMatch(plain("404.html"), /type="module"|id="pulso-data"/);
  });

  it("hydrates only the weekly audio: its page, and the cover that shows its card", () => {
    const cover = withWeekly("index.html");
    assert.match(cover, /<script type="module" crossorigin src="\/assets\/index-abc\.js"><\/script>/);
    assert.match(cover, /id="pulso-data"/);

    const episode = withWeekly("semana/2026-W41/index.html");
    assert.match(episode, /type="module"/);
    assert.match(episode, /<meta name="robots" content="noindex, follow" \/>/);
    assert.equal(canonicalOf(episode), `${ORIGIN}/semana/2026-W41/`);

    assert.doesNotMatch(withWeekly("2026-10-10/index.html"), /type="module"|id="pulso-data"/);
  });

  it("points the episode's cited item addresses at the original reporting", () => {
    // The weekly links a cited story by the address it had when the episode was produced.
    const old = withWeekly("2026-09-30/tarde/noticia/abc/index.html");
    assert.match(old, /<meta http-equiv="refresh" content="0; url=https:\/\/tech\.example\.net\/antiga" \/>/);
    assert.match(old, /noindex/);
    assert.doesNotMatch(old, /<script/);

    const daily = withWeekly("2026-10-10/noticia/def/index.html");
    assert.match(daily, /url=https:\/\/noticias\.example\.org\/diaria/);
  });
});
