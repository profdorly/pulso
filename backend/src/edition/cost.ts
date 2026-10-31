/**
 * Real cost accounting for an edition run.
 *
 * The edition artifact publishes `costUsdApprox`, so it has to be measured rather than
 * assumed. Prices are USD per 1M tokens, standard tier, short context, as recorded in
 * research/openai-api.md. They change: `UNKNOWN_MODEL_COST` keeps an unpriced model
 * visible as a warning instead of silently costing nothing.
 */

export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // GPT-6 entries verified on https://developers.openai.com/api/docs/pricing on 2026-10-09.
  // gpt-6.1-sol is also the fidelity auditor since Bedrock access ended.
  "gpt-6-luna": { inputPerMillion: 0.1, outputPerMillion: 0.5 },
  "gpt-6.1-sol": { inputPerMillion: 2, outputPerMillion: 10 },
  // Verified on the same page on 2026-10-31; the web search beyond the feeds runs on it.
  "gpt-6.1-terra": { inputPerMillion: 1, outputPerMillion: 5 },
  "gpt-5.6-luna": { inputPerMillion: 0.2, outputPerMillion: 1.2 },
  "gpt-5.6-terra": { inputPerMillion: 2, outputPerMillion: 12 },
  "gpt-5.6-sol": { inputPerMillion: 5, outputPerMillion: 30 },
  "gpt-5.6": { inputPerMillion: 5, outputPerMillion: 30 },
};

/** USD per hosted web-search tool call (pricing page: $10.00 / 1k calls). */
export const WEB_SEARCH_CALL_USD = 0.01;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Hosted `web_search` actions billed on top of tokens. */
  webSearchCalls?: number;
}

export interface CostEntry {
  step: string;
  model: string;
  usage: TokenUsage;
  usd: number;
  priced: boolean;
}

export function priceFor(model: string): ModelPrice | undefined {
  return MODEL_PRICES[model];
}

export function usageCostUsd(model: string, usage: TokenUsage): { usd: number; priced: boolean } {
  const price = priceFor(model);
  const searchUsd = (usage.webSearchCalls ?? 0) * WEB_SEARCH_CALL_USD;
  if (!price) {
    return { usd: searchUsd, priced: false };
  }
  const tokenUsd =
    (usage.inputTokens / 1_000_000) * price.inputPerMillion +
    (usage.outputTokens / 1_000_000) * price.outputPerMillion;
  return { usd: tokenUsd + searchUsd, priced: true };
}

export interface CostLedger {
  record(step: string, model: string, usage: TokenUsage | undefined): void;
  entries(): CostEntry[];
  totalUsd(): number;
  unpricedModels(): string[];
}

export function createCostLedger(): CostLedger {
  const entries: CostEntry[] = [];

  return {
    record(step, model, usage) {
      if (!usage) return;
      const { usd, priced } = usageCostUsd(model, usage);
      entries.push({ step, model, usage, usd, priced });
    },
    entries() {
      return [...entries];
    },
    totalUsd() {
      const total = entries.reduce((sum, entry) => sum + entry.usd, 0);
      // Six decimals: a Luna summarisation run costs fractions of a cent.
      return Number(total.toFixed(6));
    },
    unpricedModels() {
      return [...new Set(entries.filter((entry) => !entry.priced).map((entry) => entry.model))];
    },
  };
}

interface OpenAiUsageShape {
  input_tokens?: unknown;
  output_tokens?: unknown;
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Extracts token usage from a Responses API result, tolerating field renames. */
export function usageFromResponse(response: unknown, webSearchCalls = 0): TokenUsage | undefined {
  if (!response || typeof response !== "object") return undefined;
  const usage = (response as { usage?: OpenAiUsageShape }).usage;
  if (!usage || typeof usage !== "object") {
    return webSearchCalls > 0 ? { inputTokens: 0, outputTokens: 0, webSearchCalls } : undefined;
  }
  const inputTokens = toCount(usage.input_tokens) || toCount(usage.prompt_tokens);
  const outputTokens = toCount(usage.output_tokens) || toCount(usage.completion_tokens);
  if (inputTokens === 0 && outputTokens === 0 && webSearchCalls === 0) return undefined;
  return { inputTokens, outputTokens, ...(webSearchCalls > 0 ? { webSearchCalls } : {}) };
}

/** Counts billable hosted search actions in a Responses API output array. */
export function countWebSearchCalls(output: unknown): number {
  if (!Array.isArray(output)) return 0;
  let calls = 0;
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as { type?: unknown; action?: { type?: unknown } };
    if (record.type === "web_search_call" && record.action?.type === "search") {
      calls += 1;
    }
  }
  return calls;
}
