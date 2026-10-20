/**
 * Writes every page of the site as static HTML, with its own metadata, from the SSR bundle.
 *
 * Pages ship no script. The only exception is the weekly audio: its page, and the cover when an
 * episode exists (the cover shows the episode card), keep the reader bundle and the JSON block it
 * hydrates from. Everything else is complete as served.
 *
 * Usage: node scripts/prerender.mjs [--dir dist-site] [--ssr <entry-server.js>]
 *                                   [--editions <dir>] [--weekly <dir>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { editionPath as scriptEditionPath } from "./lib/edition-paths.mjs";
import { argValue, readJson, readPublicEditions, resolveEditionsDir, resolveWeeklyDir } from "./lib/site-source.mjs";
import { contentSecurityPolicy, cspMetaTag, inlineScriptHashes } from "./lib/csp.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const siteDir = path.resolve(repoRoot, argValue("--dir", "dist-site"));
// `--ssr` exists for the prerender test, which builds its own bundle from the current sources.
const ssrEntry = path.resolve(repoRoot, argValue("--ssr", "frontend/dist-ssr/entry-server.js"));

if (!existsSync(ssrEntry)) {
  throw new Error(`${path.relative(repoRoot, ssrEntry)} missing — run \`npm run build:ssr\` first`);
}
const templatePath = path.join(siteDir, "index.html");
if (!existsSync(templatePath)) {
  throw new Error(`${path.relative(repoRoot, templatePath)} missing — run \`node scripts/build-site.mjs\` first`);
}

const server = await import(ssrEntry);
const {
  render,
  homeMetadata,
  editionMetadata,
  archivePageMetadata,
  methodologyMetadata,
  modelsMetadata,
  notFoundMetadata,
  absoluteUrl,
  clampDescription,
  SITE_BASE,
  SITE_ORIGIN,
  SITE_NAME,
  PUBLISHER_NAME,
  ARCHIVE_PAGE_SIZE,
  archivePageRoute,
  pageCount,
  editionPath,
  pageRoute,
} = server;

const { dir: editionsDir } = resolveEditionsDir(repoRoot);
const weeklyDir = resolveWeeklyDir(repoRoot, editionsDir);
const { index, editions, latest } = readPublicEditions(editionsDir);
if (!latest) throw new Error(`no daily edition to publish in ${path.relative(repoRoot, editionsDir)}`);

const catalogPath = path.join(editionsDir, "models.json");
const catalog = existsSync(catalogPath) ? readJson(catalogPath) : null;
const weeklyIndex = weeklyDir ? readJson(path.join(weeklyDir, "index.json")) : null;
const weeklyEpisodes = weeklyIndex?.episodes ?? [];

const template = readFileSync(templatePath, "utf8");
/** The shell without the reader bundle: what every page that does not hydrate is served as. */
const staticTemplate = template
  .replace(/\s*<script type="module"[^>]*><\/script>/g, "")
  .replace(/\s*<link rel="modulepreload"[^>]*>/g, "");

/** One policy for every page: the shell's inline scripts are the only ones any page carries. */
const CSP_META = cspMetaTag(contentSecurityPolicy(inlineScriptHashes(template)));

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** JSON embedded in a script tag must not be able to close it. */
function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028");
}

function headFor(meta) {
  const tags = [
    // First, so it covers every script and resource after it.
    CSP_META,
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(meta.canonical)}" />`,
    meta.noindex
      ? `<meta name="robots" content="noindex, follow" />`
      : `<meta name="robots" content="index, follow, max-image-preview:large" />`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta property="og:locale" content="pt_BR" />`,
    `<meta property="og:type" content="${escapeHtml(meta.ogType)}" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(meta.canonical)}" />`,
    `<meta name="twitter:card" content="${meta.image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="author" content="${escapeHtml(PUBLISHER_NAME)}" />`,
  ];

  if (meta.image) {
    tags.push(`<meta property="og:image" content="${escapeHtml(meta.image)}" />`);
    tags.push(`<meta name="twitter:image" content="${escapeHtml(meta.image)}" />`);
    if (meta.imageAlt) tags.push(`<meta property="og:image:alt" content="${escapeHtml(meta.imageAlt)}" />`);
    if (meta.imageWidth) tags.push(`<meta property="og:image:width" content="${escapeHtml(String(meta.imageWidth))}" />`);
    if (meta.imageHeight) tags.push(`<meta property="og:image:height" content="${escapeHtml(String(meta.imageHeight))}" />`);
  }
  if (meta.publishedTime) {
    tags.push(`<meta property="article:published_time" content="${escapeHtml(meta.publishedTime)}" />`);
  }
  if (meta.modifiedTime) {
    tags.push(`<meta property="article:modified_time" content="${escapeHtml(meta.modifiedTime)}" />`);
  }
  tags.push(
    `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(SITE_NAME)}" href="${escapeHtml(absoluteUrl("feed.xml"))}" />`
  );
  if (meta.jsonLd) tags.push(`<script type="application/ld+json">${safeJson(meta.jsonLd)}</script>`);
  // Which edition and catalogue this document was built from, for the publish workflow's check of
  // what the live site actually serves (scripts/site-live.mjs). Invisible to readers.
  if (meta.build) {
    for (const [name, value] of Object.entries(meta.build)) {
      if (value) tags.push(`<meta name="pulso:${escapeHtml(name)}" content="${escapeHtml(String(value))}" />`);
    }
  }

  return tags.join("\n    ");
}

/**
 * One HTML document from the shell. `hydrate` keeps the reader bundle and embeds the data the
 * page was rendered from; without it the page is complete as served and carries neither.
 */
function buildHtml({ route, meta, preloaded, hydrate = false }) {
  const appHtml = render(route, preloaded);

  let html = hydrate ? template : staticTemplate;
  html = html.replace(/<title>[\s\S]*?<\/title>/, "__PULSO_HEAD__");
  // Drop the template's placeholder robots tag; headFor emits the authoritative one.
  html = html.replace(/\s*<!--[\s\S]*?-->\s*(?=<meta name="robots")/, "\n    ");
  html = html.replace(/\s*<meta name="robots"[^>]*>/g, "");
  html = html.replace("__PULSO_HEAD__", headFor(meta));
  const data = hydrate
    ? `\n    <script type="application/json" id="pulso-data">${safeJson(preloaded)}</script>`
    : "";
  html = html.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>${data}`);
  return html;
}

const written = [];
const sitemapEntries = [];

function writeHtml(routePath, html) {
  const relative = routePath.replace(/^\/+/, "").replace(/\/+$/, "");
  const target = relative ? path.join(siteDir, relative, "index.html") : path.join(siteDir, "index.html");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, html);
  written.push(path.relative(siteDir, target));
}

function record(meta, lastmod) {
  if (!meta.noindex) sitemapEntries.push({ loc: meta.canonical, lastmod });
}

// Cover. It hydrates only when there is a weekly episode, whose card renders in the browser.
{
  const meta = { ...homeMetadata(), build: { edition: latest.id, catalogue: catalog?.capturedAt } };
  const hydrate = weeklyEpisodes.length > 0;
  writeHtml("/", buildHtml({ route: "/", meta, preloaded: { edition: latest, index }, hydrate }));
  record(meta, latest.capturedAt);
}

// Archive — one document per page.
{
  const totalPages = pageCount(index.editions.length, ARCHIVE_PAGE_SIZE);
  for (let page = 1; page <= totalPages; page += 1) {
    const meta = archivePageMetadata(index, page, totalPages);
    const route = archivePageRoute(page);
    writeHtml(route, buildHtml({ route, meta, preloaded: { index } }));
    record(meta, index.editions[0]?.capturedAt);
  }
}

// Models — driven by the catalogue artifact, which is shared by every edition.
if (catalog) {
  const meta = modelsMetadata(catalog);
  writeHtml("/modelos/", buildHtml({ route: "/modelos/", meta, preloaded: { catalog } }));
  record(meta, catalog.capturedAt);
} else {
  process.stdout.write("  aviso: models.json ausente — /modelos não foi gerada\n");
}

// Methodology — static content, and the page most worth citing.
{
  const meta = methodologyMetadata();
  writeHtml("/metodologia/", buildHtml({ route: "/metodologia/", meta, preloaded: {} }));
  record(meta, latest.capturedAt);
}

// One page per edition, at its date. Items are anchors on it, not pages of their own.
for (const edition of editions) {
  const route = pageRoute(editionPath(edition.calendarDate, edition.slot));
  const meta = editionMetadata(edition);
  writeHtml(route, buildHtml({ route, meta, preloaded: { edition, index } }));
  record(meta, edition.capturedAt);
}

/*
 * Weekly audio episodes. A document per episode so a direct link loads; noindex and out of the
 * sitemap while the weekly is a pilot. The player and transcript render in the browser.
 *
 * Each episode cites stories by the item address they had when it was produced. Items no longer
 * have pages, so each cited address gets a pointer to the story's original reporting.
 */
let weeklyCount = 0;
let citationCount = 0;
for (const entry of weeklyEpisodes) {
  const route = `/semana/${entry.weekId}/`;
  const canonical = absoluteUrl(route);
  const meta = {
    title: `${entry.title} — Pulso da Semana — ${SITE_NAME}`,
    description: clampDescription(entry.description),
    canonical,
    ogType: "article",
    noindex: true,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "PodcastEpisode",
      name: entry.title,
      description: entry.description,
      inLanguage: "pt-BR",
      url: canonical,
    },
  };
  writeHtml(route, buildHtml({ route, meta, preloaded: {}, hydrate: true }));
  weeklyCount += 1;

  const episodePath = path.join(weeklyDir, entry.weekId, "episode.json");
  if (!existsSync(episodePath)) continue;
  for (const source of readJson(episodePath).sources ?? []) {
    const [date = "", slot = "", ...rest] = String(source.itemPath ?? "").split("/");
    if (!date || !slot || rest.length === 0 || !/^https?:\/\//.test(source.url ?? "")) continue;
    writeHtml(`${scriptEditionPath(date, slot)}/${rest.join("/")}`, citationHtml(source));
    citationCount += 1;
  }
}

/** A pointer from an old item address to the reporting it summarized: no script, no index. */
function citationHtml(source) {
  // Only a web address may become a redirect target, whatever the episode file says.
  if (!/^https?:\/\//i.test(String(source.url))) throw new Error(`fonte com endereço inválido: ${source.url}`);
  const target = escapeHtml(source.url);
  const title = escapeHtml(source.title ?? source.url);
  return [
    "<!doctype html>",
    '<html lang="pt-BR">',
    "  <head>",
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <meta http-equiv="Content-Security-Policy" content="default-src 'none'" />`,
    `    <meta http-equiv="refresh" content="0; url=${target}" />`,
    '    <meta name="robots" content="noindex, follow" />',
    `    <title>${title} — ${escapeHtml(SITE_NAME)}</title>`,
    "  </head>",
    "  <body>",
    `    <main><p>Esta notícia está na fonte original: <a href="${target}">${title}</a>${source.outlet ? ` (${escapeHtml(source.outlet)})` : ""}.</p></main>`,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

// Error page, served by the host for any unknown address.
{
  const html = buildHtml({ route: "/404", meta: notFoundMetadata(), preloaded: { index } });
  writeFileSync(path.join(siteDir, "404.html"), html);
  written.push("404.html");
}

// Sitemap
{
  const urls = sitemapEntries
    .map(
      ({ loc, lastmod }) =>
        `  <url>\n    <loc>${escapeHtml(loc)}</loc>${lastmod ? `\n    <lastmod>${escapeHtml(lastmod)}</lastmod>` : ""}\n  </url>`
    )
    .join("\n");
  writeFileSync(
    path.join(siteDir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
  written.push("sitemap.xml");
}

// RSS feed of editions
{
  const items = editions
    .slice(0, 50)
    .map((edition) => {
      const url = absoluteUrl(editionPath(edition.calendarDate, edition.slot));
      return [
        "    <item>",
        `      <title>${escapeHtml(edition.digest.headline)}</title>`,
        `      <link>${escapeHtml(url)}</link>`,
        `      <guid isPermaLink="true">${escapeHtml(url)}</guid>`,
        `      <pubDate>${new Date(edition.capturedAt).toUTCString()}</pubDate>`,
        `      <description>${escapeHtml(edition.digest.lede)}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");
  writeFileSync(
    path.join(siteDir, "feed.xml"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
      "  <channel>",
      `    <title>${escapeHtml(SITE_NAME)}</title>`,
      `    <link>${escapeHtml(absoluteUrl(""))}</link>`,
      "    <description>Novidades de IA em português, com fonte citada em cada item.</description>",
      "    <language>pt-BR</language>",
      `    <lastBuildDate>${new Date(latest.capturedAt).toUTCString()}</lastBuildDate>`,
      `    <atom:link href="${escapeHtml(absoluteUrl("feed.xml"))}" rel="self" type="application/rss+xml" />`,
      items,
      "  </channel>",
      "</rss>",
      "",
    ].join("\n")
  );
  written.push("feed.xml");
}

process.stdout.write(
  `prerendered ${written.length} files into ${path.relative(repoRoot, siteDir)}\n` +
    `  pages: 1 cover + ${pageCount(index.editions.length, ARCHIVE_PAGE_SIZE)} arquivo + ${catalog ? 1 : 0} modelos + 1 metodologia + ${editions.length} edition(s) + ${weeklyCount} semana + 404\n` +
    `  weekly citations pointing at the original: ${citationCount}\n` +
    `  sitemap: ${sitemapEntries.length} indexable URLs at ${SITE_ORIGIN}${SITE_BASE}\n`
);
