#!/usr/bin/env node
/**
 * Second pass: instead of guessing feed URLs, read the page and ask it.
 *
 * A site that publishes a feed almost always declares it in the head:
 *   <link rel="alternate" type="application/rss+xml" href="...">
 *
 * Guessing paths produces false negatives; this finds what the publisher actually advertises.
 * Also probes a few extra known feed paths for outlets named directly by the user.
 */

const UA = "Mozilla/5.0 (compatible; Pulso/0.1; +https://pulso.dorly.com.br/)";
const TIMEOUT_MS = 12_000;

const PAGES = [
  { id: "anthropic", url: "https://www.anthropic.com/news" },
  { id: "xai", url: "https://x.ai/news" },
  { id: "deepseek", url: "https://api-docs.deepseek.com/news/" },
  { id: "moonshot", url: "https://www.moonshot.ai/" },
  { id: "zai", url: "https://z.ai/blog" },
  { id: "maritaca", url: "https://www.maritaca.ai/" },
  { id: "cohere", url: "https://cohere.com/blog" },
  { id: "reuters", url: "https://www.reuters.com/technology/" },
];

const EXTRA_FEEDS = [
  "https://www.reuters.com/rssFeed/technologyNews",
  "https://feeds.reuters.com/reuters/technologyNews",
  "https://www.reuters.com/arc/outboundfeeds/news-sitemap-index/?outputType=xml",
  "https://apnews.com/hub/technology.rss",
  "https://www.nature.com/subjects/machine-learning.rss",
  "https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss",
  "https://www.euractiv.com/sections/tech/feed/",
  "https://www.scmp.com/rss/318208/feed",
];

async function get(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: response.status, body: await response.text() };
}

function declaredFeeds(html, baseUrl) {
  const found = new Set();
  const linkTags = html.match(/<link[^>]+>/gi) ?? [];
  for (const tag of linkTags) {
    if (!/rel=["']?alternate/i.test(tag)) continue;
    if (!/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (href) found.add(new URL(href, baseUrl).href);
  }
  return [...found];
}

process.stdout.write("## Feeds declarados no HTML da própria página\n\n");
for (const page of PAGES) {
  try {
    const { status, body } = await get(page.url);
    const feeds = declaredFeeds(body, page.url);
    process.stdout.write(
      `- **${page.id}** (HTTP ${status}): ${feeds.length > 0 ? feeds.join(", ") : "nenhum feed declarado"}\n`
    );
  } catch (error) {
    process.stdout.write(`- **${page.id}**: falhou — ${(error instanceof Error ? error.message : String(error)).slice(0, 50)}\n`);
  }
}

process.stdout.write("\n## Caminhos extras testados\n\n");
for (const url of EXTRA_FEEDS) {
  try {
    const { status, body } = await get(url);
    const isFeed = /<rss[\s>]|<feed[\s>]|<rdf:RDF/i.test(body);
    const items = (body.match(/<item[\s>]/gi) ?? []).length + (body.match(/<entry[\s>]/gi) ?? []).length;
    process.stdout.write(
      `- ${status === 200 && isFeed && items > 0 ? "✅" : "❌"} ${url} — HTTP ${status}, ${
        isFeed ? `${items} itens` : "não é feed"
      }\n`
    );
  } catch (error) {
    process.stdout.write(`- ❌ ${url} — ${(error instanceof Error ? error.message : String(error)).slice(0, 40)}\n`);
  }
}
