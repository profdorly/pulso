/**
 * Regenerates the README images in docs/img/.
 *
 *   diagrams  docs/img/src/*.svg → docs/img/<name>.png, with the bundled fonts and the same
 *             rasterizer as the edition covers (scripts/og-raster.mjs).
 *   shots     screenshots of the site, light and dark, through headless Chrome over the DevTools
 *             protocol. No Playwright: Node's own WebSocket talks to the Chrome already installed.
 *   covers    the 16:9 covers of the four latest editions, side by side.
 *
 * Usage:
 *   node scripts/readme-images.mjs                         # everything, from the live site
 *   node scripts/readme-images.mjs --only=diagrams         # no browser, no network
 *   node scripts/readme-images.mjs --base=http://localhost:4311 --date=2026-10-10
 *
 * --date picks the edition page to photograph (default: the latest in /arquivo/).
 * CHROME_PATH overrides where Chrome is looked for. Analytics requests are blocked, so a run
 * does not count as visits.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { assertCoverHasText, resvgFontOptions, toPalettePng } from "./og-raster.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const imgDir = path.join(repoRoot, "docs", "img");
const srcDir = path.join(imgDir, "src");

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  })
);
const base = (args.base ?? "https://pulso.dorly.com.br").replace(/\/+$/, "");
const only = args.only ? new Set(args.only.split(",")) : null;
const wants = (step) => !only || only.has(step);

function log(message) {
  process.stdout.write(`readme-images: ${message}\n`);
}

function rel(file) {
  return path.relative(repoRoot, file);
}

// --- diagrams ---------------------------------------------------------------------------------

function renderDiagrams() {
  const sources = readdirSync(srcDir).filter((name) => name.endsWith(".svg"));
  for (const name of sources) {
    const svg = readFileSync(path.join(srcDir, name), "utf8");
    const raw = new Resvg(svg, { fitTo: { mode: "original" }, font: resvgFontOptions() }).render().asPng();
    assertCoverHasText(raw, name);
    const out = path.join(imgDir, name.replace(/\.svg$/, ".png"));
    const png = toPalettePng(raw);
    writeFileSync(out, png);
    log(`wrote ${rel(out)} (${Math.round(png.length / 1024)} kB)`);
  }
}

// --- Chrome over the DevTools protocol --------------------------------------------------------

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Chrome not found; set CHROME_PATH");
  return found;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, method } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${method}: ${message.error.message}`));
        else resolve(message.result);
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }

  once(method, sessionId, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`timed out waiting for ${method}`));
      }, timeoutMs);
      const listener = (message) => {
        if (message.method === method && message.sessionId === sessionId) {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(message.params);
        }
      };
      this.listeners.add(listener);
    });
  }
}

async function launchChrome() {
  const profile = mkdtempSync(path.join(tmpdir(), "pulso-readme-"));
  const chrome = spawn(
    chromePath(),
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  const wsUrl = await new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`Chrome did not start:\n${stderr}`)), 20000);
    chrome.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    chrome.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited with ${code}:\n${stderr}`));
    });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const cdp = new Cdp(ws);
  const close = async () => {
    ws.close();
    // Chrome keeps writing to the profile until it exits; removing it earlier races that.
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    chrome.kill();
    await exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { cdp, close };
}

async function openPage(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Network.enable", {}, sessionId);
  await cdp.send(
    "Network.setBlockedURLs",
    { urls: ["*googletagmanager.com*", "*google-analytics.com*"] },
    sessionId
  );
  return sessionId;
}

async function evaluate(cdp, sessionId, expression) {
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId
  );
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

/**
 * `clip` is the source of a function run in the page that returns {x, y, width, height} in CSS
 * pixels of the document, or null for the viewport.
 */
async function screenshot(cdp, sessionId, { url, width, height, scale = 2, scheme, clip, out }) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false }, sessionId);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] }, sessionId);
  const loaded = cdp.once("Page.loadEventFired", sessionId);
  await cdp.send("Page.navigate", { url }, sessionId);
  await loaded;
  await evaluate(cdp, sessionId, "document.fonts.ready.then(() => true)");
  const rect = clip ? await evaluate(cdp, sessionId, `(${clip})()`) : null;
  if (clip && !rect) throw new Error(`nothing to clip on ${url}`);
  const { data } = await cdp.send(
    "Page.captureScreenshot",
    {
      format: "webp",
      quality: 88,
      ...(rect ? { clip: { ...rect, scale: 1 }, captureBeyondViewport: true } : {}),
    },
    sessionId
  );
  const bytes = Buffer.from(data, "base64");
  writeFileSync(out, bytes);
  log(`wrote ${rel(out)} (${Math.round(bytes.length / 1024)} kB)`);
}

// Clips. Each pads the element so the page background frames it.
const CLIP_PRIORITIES = `() => {
  const section = document.querySelector("#prioridades");
  if (!section) return null;
  const stories = section.querySelectorAll("li.pulso-story");
  const last = stories[0];
  const top = section.getBoundingClientRect();
  const bottom = last.getBoundingClientRect();
  const pad = 32;
  return { x: Math.max(0, top.left - pad), y: top.top + scrollY - pad, width: top.width + 2 * pad, height: bottom.bottom - top.top + 2 * pad };
}`;

const CLIP_VALUE_CHART = `() => {
  const figure = [...document.querySelectorAll("figure.pulso-chart")].find((f) => /Preço × inteligência/.test(f.textContent));
  if (!figure) return null;
  const r = figure.getBoundingClientRect();
  // Less padding above: the shortcut panels sit close over the chart.
  const pad = 32;
  const top = 12;
  return { x: Math.max(0, r.left - pad), y: r.top + scrollY - top, width: r.width + 2 * pad, height: r.height + top + pad };
}`;

async function latestEditionDates(count) {
  const response = await fetch(`${base}/arquivo/`);
  if (!response.ok) throw new Error(`GET ${base}/arquivo/ → ${response.status}`);
  const html = await response.text();
  const dates = [...new Set([...html.matchAll(/href="\/(\d{4}-\d{2}-\d{2})\/"/g)].map((m) => m[1]))];
  if (dates.length === 0) throw new Error("no editions listed in /arquivo/");
  return dates.sort().reverse().slice(0, count);
}

async function takeShots(cdp, sessionId) {
  const date = args.date ?? (await latestEditionDates(1))[0];
  log(`edition ${date} from ${base}`);
  for (const scheme of ["light", "dark"]) {
    const suffix = scheme === "light" ? "claro" : "escuro";
    await screenshot(cdp, sessionId, {
      url: `${base}/`,
      width: 1280,
      height: 960,
      scheme,
      out: path.join(imgDir, `capa-${suffix}.webp`),
    });
  }
  await screenshot(cdp, sessionId, {
    url: `${base}/${date}/`,
    width: 1280,
    height: 900,
    scheme: "light",
    clip: CLIP_PRIORITIES,
    out: path.join(imgDir, "edicao.webp"),
  });
  await screenshot(cdp, sessionId, {
    url: `${base}/modelos/`,
    width: 1280,
    height: 900,
    scheme: "light",
    clip: CLIP_VALUE_CHART,
    out: path.join(imgDir, "modelos.webp"),
  });
}

async function coverGrid(cdp, sessionId) {
  const dates = await latestEditionDates(4);
  const covers = [];
  for (const date of dates) {
    const page = await (await fetch(`${base}/${date}/`)).text();
    const og = page.match(/property="og:image" content="([^"]+)"/)?.[1];
    if (!og || !/\/editions\//.test(og)) continue;
    // The og:image is absolute to the production origin; fetch it from --base.
    const coverUrl = `${base}${new URL(og).pathname}`;
    const response = await fetch(coverUrl);
    if (!response.ok) throw new Error(`GET ${coverUrl} → ${response.status}`);
    covers.push({ date, data: Buffer.from(await response.arrayBuffer()).toString("base64") });
  }
  if (covers.length < 4) throw new Error(`only ${covers.length} covers found`);
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:#110d0b}
    .grid{display:grid;grid-template-columns:repeat(2,600px);gap:16px;padding:16px;width:max-content}
    img{display:block;width:600px;height:337.5px;border-radius:10px}
  </style><div class="grid">${covers
    .map((cover) => `<img alt="" src="data:image/png;base64,${cover.data}">`)
    .join("")}</div>`;
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1248, height: 723, deviceScaleFactor: 1, mobile: false }, sessionId);
  const { frameTree } = await cdp.send("Page.getFrameTree", {}, sessionId);
  await cdp.send("Page.setDocumentContent", { frameId: frameTree.frame.id, html }, sessionId);
  await evaluate(cdp, sessionId, "Promise.all([...document.images].map((i) => i.decode())).then(() => true)");
  const { data } = await cdp.send("Page.captureScreenshot", { format: "webp", quality: 90 }, sessionId);
  const out = path.join(imgDir, "capas.webp");
  const bytes = Buffer.from(data, "base64");
  writeFileSync(out, bytes);
  log(`wrote ${rel(out)} (${Math.round(bytes.length / 1024)} kB) — ${covers.map((c) => c.date).join(", ")}`);
}

// --- main -------------------------------------------------------------------------------------

mkdirSync(imgDir, { recursive: true });
if (wants("diagrams")) renderDiagrams();
if (wants("shots") || wants("covers")) {
  const { cdp, close } = await launchChrome();
  try {
    const sessionId = await openPage(cdp);
    if (wants("shots")) await takeShots(cdp, sessionId);
    if (wants("covers")) await coverGrid(cdp, sessionId);
  } finally {
    await close();
  }
}
