import { describe, it, expect, vi } from "vitest";
import {
  AA_FREE_URL,
  fetchBenchmarks,
  inferRegion,
  normalizeAaModel,
} from "./benchmarks.js";

const AA_FIXTURE = {
  id: "model-gpt-5",
  name: "GPT-5",
  slug: "gpt-5",
  model_creator: { name: "OpenAI", slug: "openai" },
  evaluations: {
    artificial_analysis_intelligence_index: 85.5,
    artificial_analysis_coding_index: 80.25,
    artificial_analysis_agentic_index: 70,
  },
  pricing: {
    price_1m_input_tokens: 1.25,
    price_1m_output_tokens: 10,
  },
  performance: {
    median_output_tokens_per_second: 100.5,
    median_time_to_first_token_seconds: 0.4,
    median_end_to_end_response_time_seconds: 2.1,
  },
};

const AA_PAGE_TWO = {
  id: "model-deepseek",
  name: "DeepSeek-V3",
  slug: "deepseek-v3",
  model_creator: { name: "DeepSeek", slug: "deepseek" },
  evaluations: {
    artificial_analysis_intelligence_index: 72,
    artificial_analysis_coding_index: 68,
    artificial_analysis_agentic_index: 55,
  },
  pricing: { input: 0.27, output: 1.1 },
  performance: {
    median_output_tokens_per_second: 60,
    median_time_to_first_token_seconds: 0.8,
    median_end_to_end_response_time_seconds: 3.2,
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchInput = Parameters<typeof fetch>[0];

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe("inferRegion", () => {
  it("maps chinese, brazilian, and us-global labs", () => {
    expect(inferRegion("DeepSeek", "DeepSeek-V3")).toBe("asia");
    expect(inferRegion("Alibaba", "Qwen3")).toBe("asia");
    expect(inferRegion("Moonshot", "Kimi K2")).toBe("asia");
    expect(inferRegion("Maritaca", "Sabiá")).toBe("brazil");
    expect(inferRegion("OpenAI", "GPT-5")).toBe("us");
    expect(inferRegion("Anthropic", "Claude")).toBe("us");
  });
});

describe("normalizeAaModel", () => {
  it("maps an AA fixture object to numeric metrics", () => {
    const row = normalizeAaModel(AA_FIXTURE);
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      modelId: "gpt-5",
      name: "GPT-5",
      creator: "OpenAI",
      region: "us",
      intelligenceIndex: 85.5,
      codingIndex: 80.25,
      agenticIndex: 70,
      priceInput: 1.25,
      priceOutput: 10,
      throughput: 100.5,
      ttft: 0.4,
      e2eLatency: 2.1,
      contextWindow: 400_000,
    });
  });

  it("returns null for unusable payloads", () => {
    expect(normalizeAaModel(null)).toBeNull();
    expect(normalizeAaModel("gpt-5")).toBeNull();
    expect(normalizeAaModel({})).toBeNull();
  });
});

describe("fetchBenchmarks", () => {
  it("paginates AA until has_more is false", async () => {
    const fetchImpl = vi.fn((input: FetchInput) => {
      const url = urlOf(input);
      if (url.startsWith(AA_FREE_URL)) {
        const page = new URL(url).searchParams.get("page");
        if (!page || page === "1") {
          return jsonResponse({
            pagination: { page: 1, page_size: 1, total_pages: 2, has_more: true },
            data: [AA_FIXTURE],
          });
        }
        if (page === "2") {
          return jsonResponse({
            pagination: { page: 2, page_size: 1, total_pages: 2, has_more: false },
            data: [AA_PAGE_TWO],
          });
        }
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });

    const result = await fetchBenchmarks({
      aaApiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const aaCalls = fetchImpl.mock.calls
      .map(([input]) => urlOf(input))
      .filter((url) => url.startsWith(AA_FREE_URL));
    expect(aaCalls).toHaveLength(2);
    expect(aaCalls[1]).toContain("page=2");
    expect(result.error).toBeUndefined();
    expect(result.fromCache).toBe(false);
    expect(result.snapshot.provider).toBe("artificial-analysis");
    expect(result.snapshot.payload.rows.map((row) => row.modelId)).toEqual([
      "gpt-5",
      "deepseek-v3",
    ]);
    expect(result.snapshot.payload.rows[0]?.intelligenceIndex).toBe(85.5);
    expect(result.snapshot.payload.rows[0]?.sources).toEqual(["artificial-analysis"]);
    expect(result.snapshot.payload.rows[1]?.region).toBe("asia");
  });

  it("does not call anything without a key, and says why the snapshot is empty", async () => {
    const fetchImpl = vi.fn(() => jsonResponse({}));
    const result = await fetchBenchmarks({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.error).toMatch(/ARTIFICIAL_ANALYSIS_API_KEY/);
    expect(result.snapshot).toMatchObject({ provider: "none", payload: { rows: [] } });
  });

  it("returns an empty snapshot and an error when the source fails, without throwing", async () => {
    const fetchImpl = vi.fn(() => {
      throw new Error("network down");
    });

    let result: Awaited<ReturnType<typeof fetchBenchmarks>> | undefined;
    await expect(
      (async () => {
        result = await fetchBenchmarks({
          aaApiKey: "test-key",
          fetchImpl: fetchImpl as unknown as typeof fetch,
        });
      })()
    ).resolves.toBeUndefined();

    expect(result?.error).toMatch(/Artificial Analysis/);
    expect(result?.snapshot.payload.rows).toEqual([]);
    // The source did not answer, so the snapshot must not claim it.
    expect(result?.snapshot.provider).toBe("none");
    expect(result?.fromCache).toBe(false);
  });
});
