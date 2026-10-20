#!/usr/bin/env node
/**
 * Probes candidate RSS/Atom feeds and reports which ones are actually usable.
 *
 * Two questions this answers with measurement instead of assumption:
 *
 *   1. Which labs publish a feed? Every lab that does can move off AI discovery, which
 *      costs a hosted web-search call per run. A feed costs nothing.
 *   2. Which media outlets still publish a feed, and per section? Geographic balance needs
 *      European and Asian press, and we cannot balance what we cannot fetch.
 *
 * One request per URL, honest User-Agent. Writes a Markdown table to stdout.
 *
 * Usage: node scripts/probe-feeds.mjs [--json]
 */

const UA = "Mozilla/5.0 (compatible; Pulso/0.1; +https://pulso.dorly.com.br/)";
const TIMEOUT_MS = 12_000;
const CONCURRENCY = 8;

/** group: where it would sit in the catalogue. kind: lab announcement vs press coverage. */
const CANDIDATES = [
  // ---- Labs already in the catalogue as RSS (controls) ----
  { id: "openai-news", kind: "lab", group: "us", url: "https://openai.com/news/rss.xml", note: "já usado" },
  { id: "google-deepmind", kind: "lab", group: "us", url: "https://deepmind.google/blog/rss.xml", note: "já usado" },
  { id: "google-ai-blog", kind: "lab", group: "us", url: "https://blog.google/technology/ai/rss/", note: "já usado — falhou em staging" },
  { id: "google-gemini", kind: "lab", group: "us", url: "https://blog.google/products/gemini/rss/", note: "já usado — falhou em staging" },

  // ---- Labs currently on AI discovery (paid web search) ----
  { id: "anthropic-a", kind: "lab", group: "us", url: "https://www.anthropic.com/news/rss.xml" },
  { id: "anthropic-b", kind: "lab", group: "us", url: "https://www.anthropic.com/rss.xml" },
  { id: "anthropic-c", kind: "lab", group: "us", url: "https://www.anthropic.com/feed.xml" },
  { id: "xai-a", kind: "lab", group: "us", url: "https://x.ai/rss.xml" },
  { id: "xai-b", kind: "lab", group: "us", url: "https://x.ai/news/rss.xml" },
  { id: "xai-c", kind: "lab", group: "us", url: "https://x.ai/blog/rss.xml" },
  { id: "deepseek-a", kind: "lab", group: "asia", url: "https://api-docs.deepseek.com/rss.xml" },
  { id: "deepseek-b", kind: "lab", group: "asia", url: "https://www.deepseek.com/rss.xml" },
  { id: "qwen-a", kind: "lab", group: "asia", url: "https://qwenlm.github.io/blog/index.xml" },
  { id: "qwen-b", kind: "lab", group: "asia", url: "https://qwenlm.github.io/index.xml" },
  { id: "qwen-c", kind: "lab", group: "asia", url: "https://qwen.ai/rss.xml" },
  { id: "moonshot-a", kind: "lab", group: "asia", url: "https://www.moonshot.ai/rss.xml" },
  { id: "moonshot-b", kind: "lab", group: "asia", url: "https://moonshotai.github.io/index.xml" },
  { id: "zai-a", kind: "lab", group: "asia", url: "https://z.ai/rss.xml" },
  { id: "zai-b", kind: "lab", group: "asia", url: "https://blog.z.ai/rss.xml" },
  { id: "maritaca-a", kind: "lab", group: "brazil", url: "https://www.maritaca.ai/blog/rss.xml" },
  { id: "maritaca-b", kind: "lab", group: "brazil", url: "https://maritaca.ai/feed" },

  // ---- Labs not yet in the catalogue (Europe / Canada / Japan) ----
  { id: "mistral-a", kind: "lab", group: "europe", url: "https://mistral.ai/news/rss.xml" },
  { id: "mistral-b", kind: "lab", group: "europe", url: "https://mistral.ai/rss.xml" },
  { id: "mistral-c", kind: "lab", group: "europe", url: "https://mistral.ai/feed.xml" },
  { id: "stability", kind: "lab", group: "europe", url: "https://stability.ai/news?format=rss" },
  { id: "cohere", kind: "lab", group: "us", url: "https://cohere.com/blog/rss.xml" },
  { id: "sakana", kind: "lab", group: "asia", url: "https://sakana.ai/blog/rss.xml" },
  { id: "nvidia-blog", kind: "lab", group: "us", url: "https://blogs.nvidia.com/feed/" },
  { id: "microsoft-research", kind: "lab", group: "us", url: "https://www.microsoft.com/en-us/research/feed/" },

  // ---- Press already in the catalogue (controls) ----
  { id: "the-verge-ai", kind: "press", group: "us", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", note: "já usado" },
  { id: "scmp-tech", kind: "press", group: "asia", url: "https://www.scmp.com/rss/36/feed", note: "já usado" },

  // ---- Press candidates: US / global ----
  { id: "reuters-tech", kind: "press", group: "us", url: "https://www.reuters.com/arc/outboundfeeds/rss/category/technology/?outputType=xml" },
  { id: "wired-ai", kind: "press", group: "us", url: "https://www.wired.com/feed/tag/ai/latest/rss" },
  { id: "rest-of-world", kind: "press", group: "us", url: "https://restofworld.org/feed/latest/" },

  // ---- Press candidates: Europe ----
  { id: "guardian-tech", kind: "press", group: "europe", url: "https://www.theguardian.com/technology/rss" },
  { id: "the-register", kind: "press", group: "europe", url: "https://www.theregister.com/headlines.atom" },
  { id: "heise", kind: "press", group: "europe", url: "https://www.heise.de/rss/heise-atom.xml" },
  { id: "sifted", kind: "press", group: "europe", url: "https://sifted.eu/feed" },
  { id: "lemonde-pixels", kind: "press", group: "europe", url: "https://www.lemonde.fr/pixels/rss_full.xml" },
  { id: "ft-tech", kind: "press", group: "europe", url: "https://www.ft.com/technology?format=rss" },

  // ---- Press candidates: Asia ----
  { id: "nikkei-asia", kind: "press", group: "asia", url: "https://asia.nikkei.com/rss/feed/nar" },
  { id: "japan-times", kind: "press", group: "asia", url: "https://www.japantimes.co.jp/feed/" },
  { id: "korea-herald", kind: "press", group: "asia", url: "https://www.koreaherald.com/rss/newsAll" },
  { id: "technode", kind: "press", group: "asia", url: "https://technode.com/feed/", note: "já usado" },
];

function countMatches(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

/** Newest entry date a feed advertises, so a stale feed is visible as stale. */
function newestDate(xml) {
  // The date is the captured text between the tags; nothing is stripped out of markup.
  const stamps = [...xml.matchAll(/<(pubDate|updated|published)>([^<]+)<\/\1>/gi)]
    .map((match) => Date.parse(match[2].trim()))
    .filter((value) => Number.isFinite(value));
  if (stamps.length === 0) return null;
  return new Date(Math.max(...stamps)).toISOString().slice(0, 10);
}

async function probe(candidate) {
  const started = Date.now();
  try {
    const response = await fetch(candidate.url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    const ms = Date.now() - started;

    if (!response.ok) {
      return { ...candidate, ok: false, status: response.status, verdict: `HTTP ${response.status}`, ms };
    }

    const isFeed = /<rss[\s>]|<feed[\s>]|<rdf:RDF/i.test(body);
    if (!isFeed) {
      const looksHtml = /^\s*<!doctype html|<html/i.test(body);
      return {
        ...candidate,
        ok: false,
        status: response.status,
        verdict: looksHtml ? "HTML, não é feed" : `não é feed (${contentType.split(";")[0] || "?"})`,
        ms,
      };
    }

    const items = countMatches(body, /<item[\s>]/gi) + countMatches(body, /<entry[\s>]/gi);
    return {
      ...candidate,
      ok: items > 0,
      status: response.status,
      items,
      newest: newestDate(body),
      bytes: body.length,
      verdict: items > 0 ? "feed ok" : "feed vazio",
      ms,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...candidate, ok: false, verdict: message.slice(0, 40), ms: Date.now() - started };
  }
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const results = await pool(CANDIDATES, CONCURRENCY, probe);

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} else {
  for (const kind of ["lab", "press"]) {
    process.stdout.write(`\n## ${kind === "lab" ? "Labs (fonte primária)" : "Imprensa"}\n\n`);
    process.stdout.write("| id | grupo | itens | mais recente | veredito | nota |\n");
    process.stdout.write("| --- | --- | --- | --- | --- | --- |\n");
    for (const row of results.filter((entry) => entry.kind === kind)) {
      process.stdout.write(
        `| ${row.id} | ${row.group} | ${row.items ?? "—"} | ${row.newest ?? "—"} | ${
          row.ok ? "✅ " : "❌ "
        }${row.verdict} | ${row.note ?? ""} |\n`
      );
    }
  }
  const okCount = results.filter((row) => row.ok).length;
  process.stdout.write(`\n${okCount}/${results.length} candidatos com feed utilizável\n`);
}
