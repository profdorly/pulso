/**
 * Fetcher contracts for the edition pipeline.
 *
 * The result shapes are NOT redefined here: they are re-exported from the fetchers that actually
 * produce them, so a contract cannot drift from the real return type without anything failing.
 */
import type { NewsItem, Source } from "../types.js";
import type { RssFetchResult } from "../fetchers/rss.js";
import type { BenchmarkFetchResult } from "../fetchers/benchmarks.js";

export type { RssFetchResult, BenchmarkFetchResult };

/** What `fetchRssSources` resolves to: every item, plus the per-source outcome. */
export interface RssBatchResult {
  items: NewsItem[];
  results: RssFetchResult[];
}

export interface RssFetcher {
  fetchRssSources: (
    sources: Source[],
    options?: { maxItems?: number }
  ) => Promise<RssBatchResult>;
}

export interface BenchmarkFetcher {
  fetchBenchmarks: (options: { aaApiKey?: string }) => Promise<BenchmarkFetchResult>;
}
