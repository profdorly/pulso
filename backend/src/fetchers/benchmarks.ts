import type { BenchmarkModelRow, BenchmarkSnapshot, Region } from "../types.js";

export const AA_FREE_URL = "https://artificialanalysis.ai/api/v2/language/models/free";

export const CONTEXT_WINDOW_MAP: Record<string, number> = {
  "gpt-5": 400_000,
  "gpt-5-mini": 400_000,
  "gpt-5-nano": 400_000,
  "gpt-4.1": 1_047_576,
  "gpt-4.1-mini": 1_047_576,
  "gpt-4.1-nano": 1_047_576,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  o3: 200_000,
  "o3-mini": 200_000,
  "o4-mini": 200_000,
  o1: 200_000,
  "o1-mini": 128_000,
  "claude-opus-4.6": 200_000,
  "claude-opus-4.1": 200_000,
  "claude-opus-4": 200_000,
  "claude-sonnet-4.5": 200_000,
  "claude-sonnet-4": 200_000,
  "claude-haiku-4": 200_000,
  "claude-4": 200_000,
  "claude-3.7-sonnet": 200_000,
  "claude-3.5-sonnet": 200_000,
  "claude-3-opus": 200_000,
  "claude-3-sonnet": 200_000,
  "claude-3-haiku": 200_000,
  claude: 200_000,
  "gemini-2.5-pro": 1_048_576,
  "gemini-2.5-flash": 1_048_576,
  "gemini-2.0-flash": 1_048_576,
  "gemini-1.5-pro": 2_000_000,
  "gemini-1.5-flash": 1_000_000,
  gemini: 1_048_576,
  "llama-4-scout": 10_000_000,
  "llama-4-maverick": 1_000_000,
  "llama-4": 10_000_000,
  "llama-3.3-70b": 128_000,
  "llama-3.3": 128_000,
  "llama-3.1-405b": 128_000,
  "llama-3.1": 128_000,
  llama: 128_000,
  "deepseek-v3.1": 164_000,
  "deepseek-v3": 128_000,
  "deepseek-r1": 128_000,
  deepseek: 128_000,
  "qwen3-max": 262_144,
  qwen3: 131_072,
  "qwen2.5-max": 131_072,
  "qwen2.5": 131_072,
  qwen: 131_072,
  "kimi-k2": 128_000,
  kimi: 128_000,
  moonshot: 128_000,
  "glm-4.6": 128_000,
  "glm-4.5": 128_000,
  "glm-4": 128_000,
  glm: 128_000,
  maritaca: 32_768,
  "sabia-3": 32_768,
  sabia: 32_768,
  sabiazinho: 8_192,
};

const ASIA_HINTS = [
  "deepseek",
  "qwen",
  "kimi",
  "moonshot",
  "zhipu",
  "glm",
  "alibaba",
  "z.ai",
  "baidu",
  "ernie",
  "minimax",
  "tencent",
  "hunyuan",
  "bytedance",
  "doubao",
  "sakana",
  "naver",
  "upstage",
];
const BRAZIL_HINTS = ["maritaca", "sabia"];
const US_HINTS = ["openai", "anthropic", "google", "meta", "xai", "microsoft", "deepmind", "nvidia", "cohere", "ai2", "allen institute"];
// Europe had no hints at all before the region split, so every European lab was silently
// filed as US.
const EUROPE_HINTS = ["mistral", "stability", "aleph alpha", "deepl", "black forest", "kyutai", "silo ai"];

const MAX_AA_PAGES = 50;

export interface BenchmarkFetchOptions {
  aaApiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface BenchmarkFetchResult {
  snapshot: BenchmarkSnapshot;
  error?: string;
  fromCache?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function toFiniteNumber(value: unknown, depth = 0): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (depth < 2 && value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const key of ["median", "value", "p50", "seconds", "tokens_per_second"]) {
      const n = toFiniteNumber(rec[key], depth + 1);
      if (n !== null) return n;
    }
  }
  return null;
}

function pickNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const n = toFiniteNumber(source[key]);
    if (n !== null) return n;
  }
  return null;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function inferRegion(creator?: string, name?: string): Region | undefined {
  const hay = `${creator ?? ""} ${name ?? ""}`.toLowerCase();
  if (!hay.trim()) return undefined;
  // Europe before US: "Mistral Large" would otherwise never be reached, since a European lab
  // shipping on a US cloud can trip a US hint.
  if (EUROPE_HINTS.some((hint) => hay.includes(hint))) return "europe";
  if (ASIA_HINTS.some((hint) => hay.includes(hint))) return "asia";
  if (BRAZIL_HINTS.some((hint) => hay.includes(hint))) return "brazil";
  if (US_HINTS.some((hint) => hay.includes(hint))) return "us";
  return undefined;
}

function lookupContextWindow(modelId?: string, name?: string): number | undefined {
  const candidates = [modelId, name]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  for (const candidate of candidates) {
    if (candidate in CONTEXT_WINDOW_MAP) return CONTEXT_WINDOW_MAP[candidate];
  }

  const keys = Object.keys(CONTEXT_WINDOW_MAP).sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    for (const key of keys) {
      if (candidate.includes(key) || key.includes(candidate)) {
        return CONTEXT_WINDOW_MAP[key];
      }
    }
  }
  return undefined;
}

export function normalizeAaModel(raw: unknown): BenchmarkModelRow | null {
  const rec = asRecord(raw);
  if (!rec) return null;

  const creatorRec = asRecord(rec.model_creator);
  const creator =
    asString(creatorRec?.name) ??
    asString(creatorRec?.slug) ??
    asString(rec.creator) ??
    asString(rec.model_creator);

  const slug = asString(rec.slug);
  const id = asString(rec.id);
  const name = asString(rec.name) ?? slug ?? id;
  const modelId = slug ?? id ?? (name ? slugify(name) : undefined);
  if (!modelId || !name) return null;

  const evaluations = asRecord(rec.evaluations) ?? rec;
  const pricing = asRecord(rec.pricing) ?? rec;
  const performance = asRecord(rec.performance) ?? rec;

  const intelligenceIndex = pickNumber(evaluations, [
    "artificial_analysis_intelligence_index",
    "intelligence_index",
    "intelligenceIndex",
  ]);
  const codingIndex = pickNumber(evaluations, [
    "artificial_analysis_coding_index",
    "coding_index",
    "codingIndex",
  ]);
  const agenticIndex = pickNumber(evaluations, [
    "artificial_analysis_agentic_index",
    "agentic_index",
    "agenticIndex",
  ]);

  const priceInput = pickNumber(pricing, [
    "price_1m_input_tokens",
    "input",
    "input_price",
    "price_input",
    "input_tokens",
  ]);
  const priceOutput = pickNumber(pricing, [
    "price_1m_output_tokens",
    "output",
    "output_price",
    "price_output",
    "output_tokens",
  ]);

  const throughput = pickNumber(performance, [
    "median_output_tokens_per_second",
    "output_tokens_per_second",
    "throughput",
    "output_tokens_per_s",
  ]);
  const ttft = pickNumber(performance, [
    "median_time_to_first_token_seconds",
    "median_time_to_first_token",
    "time_to_first_token_seconds",
    "time_to_first_token",
    "ttft",
  ]);
  const e2eLatency = pickNumber(performance, [
    "median_end_to_end_response_time_seconds",
    "median_end_to_end_latency",
    "end_to_end_response_time_seconds",
    "e2e_latency",
    "e2e",
  ]);

  return {
    modelId,
    name,
    creator,
    region: inferRegion(creator, name),
    intelligenceIndex,
    codingIndex,
    agenticIndex,
    priceInput,
    priceOutput,
    throughput,
    ttft,
    e2eLatency,
    contextWindow: lookupContextWindow(modelId, name) ?? null,
    sources: ["artificial-analysis"],
  };
}

function emptySnapshot(): BenchmarkSnapshot {
  return {
    id: crypto.randomUUID(),
    provider: "none",
    capturedAt: new Date().toISOString(),
    payload: { rows: [] },
  };
}

/**
 * The provider records whether the source answered, never whether it was configured. The
 * cover credits it by name from this field, so claiming a source that returned nothing would
 * put a false byline on published numbers.
 */
export function providerFor(aaRowCount: number): BenchmarkSnapshot["provider"] {
  return aaRowCount > 0 ? "artificial-analysis" : "none";
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit
): Promise<unknown> {
  const response = await fetchImpl(url, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Invalid JSON from ${url}`);
  }
}

function extractModelArray(body: unknown): unknown[] {
  const rec = asRecord(body);
  if (!rec) return [];
  if (Array.isArray(rec.data)) return rec.data;
  if (Array.isArray(rec.models)) return rec.models;
  const nested = asRecord(rec.data);
  if (nested && Array.isArray(nested.models)) return nested.models;
  return [];
}

function shouldFetchNextAaPage(body: unknown, page: number): boolean {
  const rec = asRecord(body);
  const pagination = asRecord(rec?.pagination);
  if (!pagination) return false;
  const currentPage = toFiniteNumber(pagination.page) ?? page;
  const totalPages = toFiniteNumber(pagination.total_pages);
  if (pagination.has_more === true) return true;
  if (totalPages !== null && currentPage < totalPages) return true;
  return false;
}

async function fetchArtificialAnalysis(
  fetchImpl: typeof fetch,
  apiKey: string
): Promise<BenchmarkModelRow[]> {
  const headers = { "x-api-key": apiKey };
  const rows: BenchmarkModelRow[] = [];
  let page = 1;
  let body: unknown;

  while (page <= MAX_AA_PAGES) {
    const url = page === 1 ? AA_FREE_URL : `${AA_FREE_URL}?page=${page}`;
    try {
      body = await fetchJson(fetchImpl, url, { headers });
    } catch (err) {
      if (page === 1) throw err;
      break;
    }

    const mapped = extractModelArray(body)
      .map((raw) => normalizeAaModel(raw))
      .filter((row): row is BenchmarkModelRow => row !== null);
    rows.push(...mapped);

    if (!shouldFetchNextAaPage(body, page)) break;
    const pagination = asRecord(asRecord(body)?.pagination);
    const currentPage = toFiniteNumber(pagination?.page) ?? page;
    page = currentPage + 1;
  }

  return rows;
}

/**
 * The weekly capture behind the cover's model card: Artificial Analysis's free language tier.
 *
 * It used to be merged with an Arena text leaderboard mirrored on GitHub. That mirror republished
 * data scraped from a site whose terms forbid scraping, so it is gone; the media arenas on /modelos
 * come from Artificial Analysis's own API, under its terms (attribution with a link).
 */
export async function fetchBenchmarks(
  options: BenchmarkFetchOptions = {}
): Promise<BenchmarkFetchResult> {
  if (!options.aaApiKey) {
    return { snapshot: emptySnapshot(), error: "ARTIFICIAL_ANALYSIS_API_KEY ausente", fromCache: false };
  }
  try {
    const rows = await fetchArtificialAnalysis(options.fetchImpl ?? globalThis.fetch, options.aaApiKey);
    const snapshot: BenchmarkSnapshot = {
      id: crypto.randomUUID(),
      provider: providerFor(rows.length),
      capturedAt: new Date().toISOString(),
      payload: { rows },
    };
    return { snapshot, fromCache: false };
  } catch (err) {
    return {
      snapshot: emptySnapshot(),
      error: `Artificial Analysis: ${errorMessage(err)}`,
      fromCache: false,
    };
  }
}
