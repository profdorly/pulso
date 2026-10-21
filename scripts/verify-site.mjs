#!/usr/bin/env node
/**
 * Smoke test for the assembled site. Serves dist-site the way the static host does — a directory
 * is answered at its trailing-slash address, `/x` redirects to `/x/`, anything unknown gets
 * 404.html with status 404 — and asserts the contract a reader and a crawler depend on:
 *
 *   - every page is complete HTML with its own metadata, and ships no script but analytics
 *   - only the weekly audio's pages carry the reader bundle and its data block
 *   - an edition lives at its date, links each item to the original reporting, and has a
 *     painted social card
 *   - edition JSON is not published, and no page links an item page
 *   - links and canonicals point at the served address, never at a redirect
 *   - models, methodology and archive render their content in HTML
 *
 * The edition's weight has a target and a ceiling (see EDITION_HTML_TARGET_KB): past the target
 * it is a warning, past the ceiling a failure. Warnings never change the exit code.
 *
 * Usage: node scripts/verify-site.mjs [--dir dist-site] [--port 4399] [--editions <dir>]
 */

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_LIGHT_FRACTION, pngLightStats } from "./og-raster.mjs";
import { editionPath } from "./lib/edition-paths.mjs";
import { argValue, readJson, readPublicEditions, resolveEditionsDir, resolveWeeklyDir } from "./lib/site-source.mjs";
import { liveEditionOf } from "./site-live.mjs";
import { cspOf, inlineScriptHashes } from "./lib/csp.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Weight of the edition page, gzip. Its size follows the day's news, not the template: with the
 * 50-item cap, full days measured 28.6–32.4 kB before the page was slimmed (share links with
 * minimal escaping, citations by URL), and a day where every item carries a long summary measures
 * ~40 kB after it. The CI fixture is 4.2 kB, so a hard 30 kB limit caught no template regression and
 * instead blocked whole days in production (2026-10-21: 30.1 kB). The AWS publisher never
 * limited the edition's weight. So 30 kB stays the target, reported as a warning on every day
 * past it, and only 50 kB, which no amount of news reaches, fails: that is a template or data
 * defect (an inlined edition JSON, say), worth stopping the deploy for.
 */
const EDITION_HTML_TARGET_KB = 30;
const EDITION_HTML_CEILING_KB = 50;
const siteBaseSource = readFileSync(path.join(repoRoot, "frontend/src/lib/siteBase.ts"), "utf8");
const ORIGIN = siteBaseSource.match(/SITE_ORIGIN\s*=\s*"([^"]+)"/)?.[1];
const GA_ID = siteBaseSource.match(/GA_MEASUREMENT_ID\s*=\s*"([^"]+)"/)?.[1];
if (!ORIGIN || !GA_ID) throw new Error("could not read SITE_ORIGIN / GA_MEASUREMENT_ID from siteBase.ts");

const siteDir = path.resolve(repoRoot, argValue("--dir", "dist-site"));
const port = Number(argValue("--port", "4399"));
if (!existsSync(path.join(siteDir, "index.html"))) {
  throw new Error(`${path.relative(repoRoot, siteDir)}/index.html missing — run \`npm run build:site\``);
}

const { dir: editionsDir } = resolveEditionsDir(repoRoot);
const { latest, editions, index } = readPublicEditions(editionsDir);
const catalogPath = path.join(editionsDir, "models.json");
const catalog = existsSync(catalogPath) ? readJson(catalogPath) : null;
const hasWeekly = resolveWeeklyDir(repoRoot, editionsDir) !== null;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".xml": "application/xml; charset=utf-8",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const target = path.join(siteDir, relative);
  const send = (status, file) => {
    res.writeHead(status, { "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  };

  if (url.pathname.endsWith("/")) {
    const page = path.join(target, "index.html");
    if (existsSync(page)) return send(200, page);
  } else if (existsSync(target) && statSync(target).isFile()) {
    return send(200, target);
  } else if (existsSync(path.join(target, "index.html"))) {
    res.writeHead(301, { location: `${url.pathname}/` });
    return res.end();
  }
  send(404, path.join(siteDir, "404.html"));
});

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
}

/** Worth a look, not worth stopping the deploy. Shows as an annotation on GitHub Actions. */
const warnings = [];
function warn(name, detail = "") {
  warnings.push({ name, detail });
}

async function get(pathname) {
  const response = await fetch(`http://localhost:${port}${pathname}`, { redirect: "manual" });
  const body = await response.text();
  return { status: response.status, body, location: response.headers.get("location") };
}

async function getBinary(pathname) {
  const response = await fetch(`http://localhost:${port}${pathname}`);
  const buf = Buffer.from(await response.arrayBuffer());
  return { status: response.status, buf, type: response.headers.get("content-type") ?? "" };
}

function checkPaintedOg(name, fetched) {
  check(`${name} resolves`, fetched.status === 200 && fetched.type.includes("image/png"), `status ${fetched.status}`);
  if (fetched.status !== 200) return;
  try {
    const stats = pngLightStats(fetched.buf);
    check(`${name} has painted type`, stats.lightFraction >= MIN_LIGHT_FRACTION, `${stats.width}x${stats.height}`);
  } catch (error) {
    check(`${name} has painted type`, false, error instanceof Error ? error.message : String(error));
  }
}

const canonicalOf = (html) => (/<link rel="canonical" href="([^"]+)"/.exec(html) ?? [])[1] ?? "";
const scriptsOf = (html) => [...html.matchAll(/<script\b([^>]*)>/gi)].map((match) => match[1]);
const localHrefs = (html) =>
  [...html.matchAll(/<a\b[^>]*\bhref="(\/[^"#]*)/g)].map((match) => match[1]).filter((href) => !href.startsWith("//"));

/** No script but the analytics bootstrap and structured data: the page is complete as served. */
function checkStatic(label, html) {
  const scripts = scriptsOf(html);
  const allowed = scripts.every(
    (attrs) =>
      attrs.includes("googletagmanager.com/gtag/js") ||
      attrs.includes('type="application/ld+json"') ||
      attrs.trim() === ""
  );
  check(`${label} ships no script but analytics`, allowed && !/type="module"/.test(html), scripts.join(" | "));
  check(`${label} embeds no hydration data`, !html.includes('id="pulso-data"'));
}

/**
 * The page declares the site's policy before any script, and the policy allows exactly the inline
 * scripts the page carries: a new inline script without its hash would silently not run.
 */
function checkCsp(label, html) {
  const policy = cspOf(html);
  check(`${label} declares a Content Security Policy`, Boolean(policy) && policy.includes("object-src 'none'"));
  const missing = inlineScriptHashes(html).filter((hash) => !policy?.includes(hash));
  check(`${label} policy allows each inline script by hash`, missing.length === 0, missing.join(" "));
  const firstScript = html.search(/<script\b/);
  check(`${label} policy comes before any script`, firstScript < 0 || html.indexOf("Content-Security-Policy") < firstScript);
}

/** Every internal link points at a served address (a page with its trailing slash, or a file). */
function checkLinks(label, html) {
  const bad = localHrefs(html).filter((href) => {
    const last = href.slice(href.lastIndexOf("/") + 1);
    return !(href.endsWith("/") || last.includes("."));
  });
  check(`${label} links pages at their served address`, bad.length === 0, bad.join(" "));
  check(`${label} links no item page`, !localHrefs(html).some((href) => href.includes("/noticia/")));
}

await new Promise((resolve) => server.listen(port, resolve));

try {
  // ---- Cover ----
  const home = await get("/");
  check("cover serves", home.status === 200, `status ${home.status}`);
  check("cover is indexable", !/name="robots"[^>]*noindex/.test(home.body));
  check("cover canonical is the origin", canonicalOf(home.body) === `${ORIGIN}/`, canonicalOf(home.body));
  check("cover og:image is the journal card", home.body.includes(`property="og:image" content="${ORIGIN}/og-pulso.png"`));
  check("cover embeds WebSite JSON-LD", /"@type":"WebSite"/.test(home.body));
  check("cover names the edition it was built from, for the live check", liveEditionOf(home.body) === latest.id, liveEditionOf(home.body));
  check("cover links the RSS feed", home.body.includes(`href="${ORIGIN}/feed.xml"`));
  check("cover loads GA4", home.body.includes(`gtag/js?id=${GA_ID}`) && home.body.includes(`gtag('config', '${GA_ID}')`));
  check("cover renders its headline in HTML", /<h1[^>]*>[^<]{10,}<\/h1>/.test(home.body));
  check("cover title names the journal", /<title>Pulso[^<]*Professor Dorly<\/title>/.test(home.body));
  check(
    "cover title is not the edition's headline",
    !(/<title>([^<]*)<\/title>/.exec(home.body)?.[1] ?? "").includes(latest.digest.headline)
  );
  check("favicon is site-absolute", home.body.includes('href="/favicon.svg"'));
  checkLinks("cover", home.body);
  checkCsp("cover", home.body);
  if (hasWeekly) {
    check("cover hydrates for the weekly card", /type="module"/.test(home.body) && home.body.includes('id="pulso-data"'));
    // The one page that runs the reader bundle: the policy must let its module script load.
    const weeklyId = readJson(path.join(resolveWeeklyDir(repoRoot, editionsDir), "index.json")).latestId;
    const weekly = await get(`/semana/${weeklyId}/`);
    check("weekly page serves", weekly.status === 200, `status ${weekly.status}`);
    checkCsp("weekly page", weekly.body);
    const modules = [...weekly.body.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map((match) => match[1]);
    check("weekly page loads its bundle from the site itself", modules.length > 0 && modules.every((src) => src.startsWith("/")), modules.join(" "));
  } else {
    checkStatic("cover", home.body);
  }

  for (const ref of [...home.body.matchAll(/(?:src|href)="(\/[^"]+\.(?:css|js|png|svg|woff2))"/g)].map((m) => m[1])) {
    const asset = await get(ref);
    check(`asset resolves: ${ref}`, asset.status === 200, `status ${asset.status}`);
  }
  checkPaintedOg("journal og card", await getBinary("/og-pulso.png"));

  // ---- Latest edition ----
  const route = `${editionPath(latest.calendarDate, latest.slot)}/`;
  const page = await get(route);
  check(`edition serves at its date: ${route}`, page.status === 200, `status ${page.status}`);
  check("edition canonical is its served address", canonicalOf(page.body) === `${ORIGIN}${route}`, canonicalOf(page.body));
  check("edition is noindex, follow", /<meta name="robots" content="noindex, follow"/.test(page.body));
  check("edition is an og:type article", /property="og:type" content="article"/.test(page.body));
  check("edition embeds NewsArticle JSON-LD", /"@type":"NewsArticle"/.test(page.body));
  check("edition renders its headline in HTML", page.body.includes(latest.digest.headline.replaceAll("&", "&amp;")));
  checkStatic("edition", page.body);
  checkLinks("edition", page.body);
  checkCsp("edition", page.body);

  const withoutSlash = await get(route.replace(/\/$/, ""));
  check("an address without the slash redirects to the page", withoutSlash.status === 301 && withoutSlash.location === route);

  for (const item of latest.items) {
    const escapedUrl = item.url.replaceAll("&", "&amp;");
    check(
      `item headline links the original: ${item.outlet}`,
      new RegExp(`<a href="${escapedUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" target="_blank" rel="noopener noreferrer" class="pulso-story-title"`).test(page.body)
    );
    check(`item carries its anchor: ${item.id.slice(0, 10)}`, page.body.includes(`id="n-${item.id.slice(0, 10)}"`));
  }
  if (latest.items.some((item) => item.summaryPt)) {
    check("the summary opens in place", /<details class="pulso-story-summary"/.test(page.body));
  }

  const ogImages = [...page.body.matchAll(/property="og:image" content="([^"]+)"/g)].map((match) => match[1]);
  check("edition og:image is its raster cover", ogImages.length === 1 && /\.og\.png$/.test(ogImages[0] ?? ""), ogImages.join(" "));
  if (ogImages[0]) {
    const card = await getBinary(new URL(ogImages[0]).pathname);
    checkPaintedOg("edition og card", card);
    check("edition og card stays under 150 kB", card.buf.length < 150 * 1024, `${(card.buf.length / 1024).toFixed(1)} kB`);
  }
  const gzipKb = gzipSync(Buffer.from(page.body)).length / 1024;
  const summaries = latest.items.filter((item) => item.summaryPt).length;
  const weight = `${gzipKb.toFixed(1)} kB — ${latest.items.length} itens, ${summaries} resumos`;
  check(`edition HTML stays under ${EDITION_HTML_CEILING_KB} kB gzip`, gzipKb < EDITION_HTML_CEILING_KB, weight);
  if (gzipKb >= EDITION_HTML_TARGET_KB) warn(`edition HTML is over the ${EDITION_HTML_TARGET_KB} kB gzip target`, weight);

  // ---- What is not published ----
  for (const pathname of [
    "/editions/latest.json",
    "/editions/index.json",
    `/editions/${latest.calendarDate}/${latest.slot}.json`,
    "/editions/models.json",
    "/.vite/manifest.json",
    `/editions/${latest.calendarDate}/${latest.slot}.cover-r1.svg`,
  ]) {
    check(`not published: ${pathname}`, (await get(pathname)).status === 404);
  }

  // ---- Feed and sitemap ----
  const feed = await get("/feed.xml");
  check("feed is served", feed.status === 200, `status ${feed.status}`);
  check("feed links each edition at its served address", feed.body.includes(`<link>${ORIGIN}${route}</link>`));
  check("feed has one item per edition, at most 50", (feed.body.match(/<item>/g) ?? []).length === Math.min(editions.length, 50));

  const sitemap = await get("/sitemap.xml");
  check("sitemap lists the cover", sitemap.body.includes(`<loc>${ORIGIN}/</loc>`));
  check("sitemap lists the methodology", sitemap.body.includes(`<loc>${ORIGIN}/metodologia/</loc>`));
  check("sitemap lists no dated edition", !new RegExp(`<loc>${ORIGIN}/\\d{4}-\\d{2}-\\d{2}`).test(sitemap.body));

  // ---- Static pages ----
  for (const [label, pathname] of [
    ["arquivo", "/arquivo/"],
    ["metodologia", "/metodologia/"],
    ...(catalog ? [["modelos", "/modelos/"]] : []),
  ]) {
    const doc = await get(pathname);
    check(`${label} serves`, doc.status === 200, `status ${doc.status}`);
    check(`${label} canonical is its served address`, canonicalOf(doc.body) === `${ORIGIN}${pathname}`, canonicalOf(doc.body));
    check(`${label} renders an h1 in HTML`, /<h1[^>]*>[^<]{3,}<\/h1>/.test(doc.body));
    checkStatic(label, doc.body);
    checkLinks(label, doc.body);
    checkCsp(label, doc.body);
    // A boundary React abandoned on the server writes its error and the build machine's paths.
    const leak = /data-(?:msg|stck|cstck)=|node_modules\/|\/Users\/|\/home\/runner\//.exec(doc.body);
    check(`${label} carries no server-render error or build paths`, !leak, leak?.[0] ?? "");
  }

  const archive = await get("/arquivo/");
  check("archive lists every published edition", (archive.body.match(/class="pulso-entry-title"/g) ?? []).length === Math.min(index.editions.length, 30));

  if (catalog) {
    const models = await get("/modelos/");
    check("models page renders a table in HTML", /<table/.test(models.body));
    check("models page embeds Dataset JSON-LD", /"@type":"Dataset"/.test(models.body));
    const first = catalog.sections?.flatMap((section) => section.models ?? [])[0];
    if (first?.name) check(`models page renders a model name: ${first.name}`, models.body.includes(first.name.replaceAll("&", "&amp;")));
  }

  const methodology = await get("/metodologia/");
  check("methodology states what is not verified", methodology.body.includes("O que não é verificado"));
  check("methodology refuses to claim absolute accuracy", /não promete acur[^<]*absoluta/.test(methodology.body));

  // ---- Errors ----
  const unknown = await get("/rota-que-nao-existe/");
  check("an unknown address is a 404", unknown.status === 404, `status ${unknown.status}`);
  check("the 404 page is noindex", /name="robots"[^>]*noindex/.test(unknown.body));
  checkStatic("404", unknown.body);
  checkCsp("404", unknown.body);
  const oldItem = await get(`${route}noticia/qualquer/`);
  check("an old item address is a 404", oldItem.status === 404, `status ${oldItem.status}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const failed = checks.filter((entry) => !entry.ok);
for (const entry of checks) {
  process.stdout.write(`${entry.ok ? "ok  " : "FAIL"} ${entry.name}${entry.detail ? ` — ${entry.detail}` : ""}\n`);
}
for (const entry of warnings) {
  const line = `${entry.name}${entry.detail ? ` — ${entry.detail}` : ""}`;
  process.stdout.write(`WARN ${line}\n`);
  if (process.env.GITHUB_ACTIONS === "true") process.stdout.write(`::warning title=verify-site::${line}\n`);
}
process.stdout.write(`\n${checks.length - failed.length}/${checks.length} checks passed, ${warnings.length} warning(s)\n`);
if (failed.length > 0) process.exit(1);
