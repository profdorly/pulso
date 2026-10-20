import type { BlockId, Category, Region, Source } from "../types.js";

function rss(
  id: string,
  name: string,
  category: Category,
  region: Region,
  block: BlockId,
  feedUrl: string,
  homepage: string
): Source {
  return { id, name, type: "rss", category, region, block, feedUrl, homepage };
}

export const SOURCES: Source[] = [
  // Official company announcements
  rss(
    "openai-news",
    "OpenAI News",
    "official-company",
    "us",
    "official",
    "https://openai.com/news/rss.xml",
    "https://openai.com/news"
  ),
  rss(
    "google-deepmind",
    "Google DeepMind",
    "official-company",
    "us",
    "official",
    "https://deepmind.google/blog/rss.xml",
    "https://deepmind.google/blog"
  ),
  rss(
    "google-ai-blog",
    "Google AI Blog",
    "official-company",
    "us",
    "official",
    "https://blog.google/technology/ai/rss/",
    "https://blog.google/technology/ai/"
  ),
  rss(
    "google-gemini",
    "Google Gemini",
    "official-company",
    "us",
    "official",
    "https://blog.google/products/gemini/rss/",
    "https://blog.google/products/gemini/"
  ),
  rss(
    "google-research",
    "Google Research",
    "official-company",
    "us",
    "official",
    "https://research.google/blog/rss/",
    "https://research.google/blog"
  ),
  rss(
    "meta-newsroom",
    "Meta Newsroom",
    "official-company",
    "us",
    "official",
    "https://about.fb.com/feed/",
    "https://about.fb.com/news/"
  ),
  rss(
    "huggingface-blog",
    "Hugging Face Blog",
    "official-company",
    "us",
    "official",
    "https://huggingface.co/blog/feed.xml",
    "https://huggingface.co/blog"
  ),
  // The only European lab with a working feed (research/feed-coverage.md). Only
  // `/rss.xml` resolves — `/news/rss.xml` and `/feed.xml` both 404.
  rss(
    "mistral",
    "Mistral AI",
    "official-company",
    "europe",
    "official",
    "https://mistral.ai/rss.xml",
    "https://mistral.ai/news"
  ),

  // Impartial media — US / global
  rss(
    "the-verge-ai",
    "The Verge — AI",
    "impartial-media",
    "us",
    "impartial",
    "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    "https://www.theverge.com/ai-artificial-intelligence"
  ),
  rss(
    "ars-technica-ai",
    "Ars Technica — AI",
    "impartial-media",
    "us",
    "impartial",
    "https://arstechnica.com/ai/feed/",
    "https://arstechnica.com/ai/"
  ),
  rss(
    "mit-technology-review-ai",
    "MIT Technology Review — AI",
    "impartial-media",
    "us",
    "impartial",
    "https://www.technologyreview.com/topic/artificial-intelligence/feed/",
    "https://www.technologyreview.com/topic/artificial-intelligence/"
  ),
  rss(
    "techcrunch-ai",
    "TechCrunch — AI",
    "impartial-media",
    "us",
    "impartial",
    "https://techcrunch.com/category/artificial-intelligence/feed/",
    "https://techcrunch.com/category/artificial-intelligence/"
  ),
  rss(
    "wired-ai",
    "Wired — AI",
    "impartial-media",
    "us",
    "impartial",
    "https://www.wired.com/feed/tag/ai/latest/rss",
    "https://www.wired.com/tag/artificial-intelligence/"
  ),
  rss(
    "rest-of-world",
    "Rest of World",
    "impartial-media",
    "us",
    "impartial",
    "https://restofworld.org/feed/latest/",
    "https://restofworld.org"
  ),
  rss(
    "ieee-spectrum-ai",
    "IEEE Spectrum — AI",
    "impartial-media",
    "us",
    "impartial",
    "https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss",
    "https://spectrum.ieee.org/topic/artificial-intelligence/"
  ),

  // Impartial media — Europe. Deliberately not English-only: a European perspective that
  // comes solely from UK outlets is a US-adjacent perspective with a different accent.
  rss(
    "guardian-tech",
    "The Guardian — Tecnologia",
    "impartial-media",
    "europe",
    "impartial",
    "https://www.theguardian.com/technology/rss",
    "https://www.theguardian.com/technology"
  ),
  rss(
    "the-register",
    "The Register",
    "impartial-media",
    "europe",
    "impartial",
    "https://www.theregister.com/headlines.atom",
    "https://www.theregister.com"
  ),
  rss(
    "sifted",
    "Sifted",
    "impartial-media",
    "europe",
    "impartial",
    "https://sifted.eu/feed",
    "https://sifted.eu"
  ),
  rss(
    "lemonde-pixels",
    "Le Monde — Pixels",
    "impartial-media",
    "europe",
    "impartial",
    "https://www.lemonde.fr/pixels/rss_full.xml",
    "https://www.lemonde.fr/pixels/"
  ),
  // Removed by measurement (research/feed-pruning.md, ago 2026): heise (4-6 slots per edition
  // of German-language items), ft-tech (feed works, but the paywall blocks the page download,
  // so its items could never carry a verifiable summary).

  // Impartial media — Asia. China-heavy on purpose: it is where most of the non-US frontier
  // work is announced, and the reader asked for that emphasis specifically.
  rss(
    "pandaily",
    "Pandaily",
    "impartial-media",
    "asia",
    "impartial",
    "https://pandaily.com/feed",
    "https://pandaily.com"
  ),
  rss(
    "sixth-tone",
    "Sixth Tone",
    "impartial-media",
    "asia",
    "impartial",
    "https://www.sixthtone.com/rss",
    "https://www.sixthtone.com"
  ),
  rss(
    "scmp-tech",
    "South China Morning Post — Tech",
    "impartial-media",
    "asia",
    "impartial",
    "https://www.scmp.com/rss/36/feed",
    "https://www.scmp.com/tech"
  ),
  rss(
    "technode",
    "TechNode",
    "impartial-media",
    "asia",
    "impartial",
    "https://technode.com/feed/",
    "https://technode.com"
  ),
  // Removed by measurement (research/feed-pruning.md, ago 2026): nikkei-asia (6-8 of every
  // edition from one outlet's whole-site business feed), japan-times (0/25 items AI-related),
  // korea-herald (1/25). Asia keeps four feeds whose AI yield is measured and real.

  // Impartial media — Brazil
  rss(
    "mit-tr-brasil",
    "MIT Technology Review Brasil",
    "impartial-media",
    "brazil",
    "impartial",
    "https://mittechreview.com.br/feed/",
    "https://mittechreview.com.br"
  ),
  rss(
    "tecnoblog",
    "Tecnoblog",
    "impartial-media",
    "brazil",
    "impartial",
    "https://tecnoblog.net/feed/",
    "https://tecnoblog.net"
  ),
  rss(
    "olhar-digital",
    "Olhar Digital",
    "impartial-media",
    "brazil",
    "impartial",
    "https://olhardigital.com.br/feed/",
    "https://olhardigital.com.br"
  ),
  rss(
    "canaltech",
    "Canaltech",
    "impartial-media",
    "brazil",
    "impartial",
    "https://canaltech.com.br/rss/",
    "https://canaltech.com.br"
  ),
  // Removed by measurement (research/feed-pruning.md, ago 2026): mobile-time (telecom trade
  // press, 1/20 items AI-related), microsoft-azure (corporate PR — Gartner MQ self-ranking,
  // not news; Microsoft's AI news arrives through the press feeds anyway).
  //
  // Labs that publish no feed at all (Anthropic, xAI, DeepSeek, Moonshot, z.ai, Maritaca; Qwen's
  // feed is abandoned — research/feed-coverage.md) are reached by the web search beyond the
  // feeds, not by a source entry here.
];

export function getSourcesByBlock(block: BlockId): Source[] {
  return SOURCES.filter((s) => s.block === block);
}

export function getSourceById(id: string): Source | undefined {
  return SOURCES.find((s) => s.id === id);
}

export function getRssSources(): Source[] {
  return SOURCES.filter((s) => s.type === "rss");
}

/**
 * Press feeds whose own scope is explicitly artificial intelligence.
 *
 * This is deliberately opt-in: every new or general-interest press source must pass the
 * thematic classifier before it can use an edition slot.
 */
const NARROW_AI_PRESS_SOURCE_IDS = new Set([
  "the-verge-ai",
  "ars-technica-ai",
  "mit-technology-review-ai",
  "techcrunch-ai",
  "wired-ai",
  "ieee-spectrum-ai",
]);

export function isNarrowAiPressSource(sourceId: string): boolean {
  return NARROW_AI_PRESS_SOURCE_IDS.has(sourceId);
}
