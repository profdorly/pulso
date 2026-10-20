import { describe, expect, it, vi } from "vitest";
import {
  AA_BASE,
  AA_ENDPOINTS,
  LANGUAGE_PUBLISH_CAP,
  MEDIA_PUBLISH_CAP,
  applyPublishCap,
  fetchModelCatalog,
  mapLanguageModel,
  mapMediaModel,
} from "./aa.js";
import { modelCatalogSchema } from "./schema.js";
import { observationFor, type Modality } from "./types.js";

const capturedAt = "2026-08-15T02:00:00.000Z";

/** Shape taken from the live free-tier response (research/aa-coverage.md). */
const LANGUAGE_FULL = {
  id: "model-1",
  name: "GPT-5.6 Terra",
  slug: "gpt-5-6-terra",
  release_date: "2026-02-16",
  model_creator: { id: "openai", name: "OpenAI" },
  evaluations: {
    artificial_analysis_intelligence_index: 57.4,
    artificial_analysis_coding_index: 51.2,
    artificial_analysis_agentic_index: 44,
  },
  pricing: { price_1m_input_tokens: 2, price_1m_output_tokens: 12 },
  performance: {
    median_output_tokens_per_second: 116,
    median_time_to_first_token_seconds: 0.42,
    median_end_to_end_response_time_seconds: 3.1,
  },
};

/** Common in the real data: index present, price and performance absent. */
const LANGUAGE_SPARSE = {
  id: "model-2",
  name: "MiMo-V2.5-Pro",
  slug: "mimo-v2-5-pro",
  model_creator: { id: "xiaomi", name: "Xiaomi" },
  evaluations: { artificial_analysis_intelligence_index: 41 },
  pricing: {},
  performance: {},
};

const MEDIA_MODEL = {
  id: "media-1",
  name: "GPT Image 2 (high)",
  slug: "gpt-image-2-high",
  model_creator: { id: "openai", name: "OpenAI" },
  elo: 1243,
  ci_95: 8,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("mapLanguageModel", () => {
  it("turns every present number into an observation with its own provenance", () => {
    const model = mapLanguageModel(LANGUAGE_FULL, capturedAt, "4.1");
    expect(model).not.toBeNull();
    expect(model?.observations).toHaveLength(8);

    const intelligence = observationFor(model!, "intelligence-index");
    expect(intelligence?.value).toBe(57.4);
    expect(intelligence?.source).toBe("artificial-analysis");
    expect(intelligence?.benchmarkVersion).toBe("4.1");
    expect(intelligence?.capturedAt).toBe(capturedAt);
    expect(intelligence?.methodologyUrl).toContain("artificialanalysis.ai");

    // Price and evaluation come from different methodologies, so they are labelled apart.
    expect(observationFor(model!, "price-input-1m")?.benchmark).toContain("Preço");
    expect(observationFor(model!, "intelligence-index")?.benchmark).toContain("Intelligence Index");
  });

  it("omits absent metrics instead of recording them as zero", () => {
    const model = mapLanguageModel(LANGUAGE_SPARSE, capturedAt);
    expect(model?.observations).toHaveLength(1);
    expect(observationFor(model!, "price-input-1m")).toBeUndefined();
    expect(observationFor(model!, "output-tokens-per-second")).toBeUndefined();
    // The trap this guards against: a missing price rendering as "US$ 0.00", the cheapest.
    expect(model?.observations.some((row) => row.value === 0)).toBe(false);
  });

  it("drops a row with no usable number at all", () => {
    expect(mapLanguageModel({ slug: "x", name: "X", evaluations: {} }, capturedAt)).toBeNull();
    expect(mapLanguageModel(null, capturedAt)).toBeNull();
    expect(mapLanguageModel({ name: "sem slug" }, capturedAt)).toBeNull();
  });
});

describe("mapMediaModel", () => {
  it("records Elo with its confidence interval and names the arena it came from", () => {
    const model = mapMediaModel(MEDIA_MODEL, "text-to-image", capturedAt);
    const elo = observationFor(model!, "arena-elo");
    expect(elo?.value).toBe(1243);
    expect(elo?.confidence95).toBe(8);
    expect(elo?.benchmark).toBe("Text to Image Arena");
  });

  it("labels the same model differently per arena, since the boards are separate", () => {
    const image = mapMediaModel(MEDIA_MODEL, "text-to-image", capturedAt);
    const video = mapMediaModel(MEDIA_MODEL, "text-to-video", capturedAt);
    expect(observationFor(image!, "arena-elo")?.benchmark).not.toBe(
      observationFor(video!, "arena-elo")?.benchmark
    );
  });

  it("drops a media row with no Elo", () => {
    expect(mapMediaModel({ slug: "x", name: "X" }, "text-to-image", capturedAt)).toBeNull();
  });
});

describe("applyPublishCap", () => {
  function languageModel(index: number, intelligence?: number) {
    return mapLanguageModel(
      {
        slug: `model-${index}`,
        name: `Model ${index}`,
        model_creator: { id: "lab", name: "Lab" },
        evaluations:
          intelligence === undefined
            ? {}
            : { artificial_analysis_intelligence_index: intelligence },
        // Keeps the row usable even with no index, so it can be ordered last rather than dropped.
        pricing: { price_1m_input_tokens: 1 },
        performance: {},
      },
      capturedAt
    )!;
  }

  it("publishes the head of the intelligence ranking and reports the untruncated total", () => {
    const models = Array.from({ length: LANGUAGE_PUBLISH_CAP + 12 }, (_, index) =>
      languageModel(index, index)
    );

    const { published, totalAvailable } = applyPublishCap(models, "language");

    expect(totalAvailable).toBe(LANGUAGE_PUBLISH_CAP + 12);
    expect(published).toHaveLength(LANGUAGE_PUBLISH_CAP);
    // Highest index first, and the cut removed the weakest models, not arbitrary ones.
    expect(observationFor(published[0], "intelligence-index")?.value).toBe(
      LANGUAGE_PUBLISH_CAP + 11
    );
    expect(observationFor(published.at(-1)!, "intelligence-index")?.value).toBe(12);
  });

  it("sinks a model with no number on the ordering axis instead of dropping it", () => {
    const { published } = applyPublishCap(
      [languageModel(1), languageModel(2, 40), languageModel(3, 55)],
      "language"
    );

    expect(published.map((model) => model.id)).toEqual(["model-3", "model-2", "model-1"]);
  });

  it("caps media by Elo, the only axis those endpoints publish", () => {
    const models = Array.from(
      { length: MEDIA_PUBLISH_CAP + 5 },
      (_, index) =>
        mapMediaModel(
          { slug: `media-${index}`, name: `Media ${index}`, elo: 1000 + index },
          "text-to-image",
          capturedAt
        )!
    );

    const { published, totalAvailable } = applyPublishCap(models, "text-to-image");

    expect(totalAvailable).toBe(MEDIA_PUBLISH_CAP + 5);
    expect(published).toHaveLength(MEDIA_PUBLISH_CAP);
    expect(observationFor(published[0], "arena-elo")?.value).toBe(1000 + MEDIA_PUBLISH_CAP + 4);
  });

  it("leaves a section below the cap untouched", () => {
    const models = [languageModel(1, 10), languageModel(2, 20)];
    const { published, totalAvailable } = applyPublishCap(models, "language");
    expect(published).toHaveLength(2);
    expect(totalAvailable).toBe(2);
  });
});

describe("fetchModelCatalog", () => {
  /** `fetch` accepts a string, a URL or a Request; only the first has a useful toString. */
  function requestUrl(input: Parameters<typeof fetch>[0]): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input.url;
  }

  function stubFetch(handler: (url: string) => Response) {
    return vi.fn((input: Parameters<typeof fetch>[0]) =>
      Promise.resolve(handler(requestUrl(input)))
    ) as unknown as typeof fetch;
  }

  it("reports no sources and does not invent data without an API key", async () => {
    const result = await fetchModelCatalog({});
    expect(result.catalog.sources).toEqual([]);
    expect(result.catalog.sections).toEqual([]);
    expect(result.errors[0]?.error).toMatch(/API_KEY/);
  });

  it("builds a catalogue with coverage counts per metric", async () => {
    const fetchImpl = stubFetch((url) => {
      if (url.endsWith(AA_ENDPOINTS.language)) {
        return jsonResponse({
          tier: "free",
          intelligence_index_version: 4.1,
          data: [LANGUAGE_FULL, LANGUAGE_SPARSE],
        });
      }
      return jsonResponse({ tier: "free", data: [MEDIA_MODEL] });
    });

    const result = await fetchModelCatalog({ apiKey: "k", fetchImpl, now: new Date(capturedAt) });

    expect(result.errors).toEqual([]);
    expect(result.catalog.sources).toEqual(["artificial-analysis"]);
    expect(modelCatalogSchema.parse(result.catalog)).toBeTruthy();

    const language = result.catalog.sections.find((section) => section.modality === "language");
    expect(language?.group).toBe("texto");
    expect(language?.models).toHaveLength(2);
    expect(language?.totalAvailable).toBe(2);

    // Coverage is what lets the UI say a price sort leaves models out.
    const priceCoverage = result.catalog.coverage.find(
      (row) => row.modality === "language" && row.metric === "price-input-1m"
    );
    expect(priceCoverage).toEqual({
      modality: "language",
      metric: "price-input-1m",
      withData: 1,
      total: 2,
    });
  });

  it("gives media sections preference data only, never capability", async () => {
    const fetchImpl = stubFetch((url) =>
      url.endsWith(AA_ENDPOINTS.language)
        ? jsonResponse({ data: [] })
        : jsonResponse({ data: [MEDIA_MODEL] })
    );

    const result = await fetchModelCatalog({ apiKey: "k", fetchImpl, now: new Date(capturedAt) });
    const media = result.catalog.sections.filter((section) => section.group !== "texto");

    expect(media.length).toBeGreaterThan(0);
    for (const section of media) {
      expect(section.availableMetrics).toEqual(["arena-elo"]);
    }
  });

  it("keeps the modalities that answered when one endpoint fails", async () => {
    const fetchImpl = stubFetch((url) => {
      if (url.endsWith(AA_ENDPOINTS["text-to-video"])) return jsonResponse({ error: "boom" }, 500);
      if (url.endsWith(AA_ENDPOINTS.language)) {
        return jsonResponse({ intelligence_index_version: 4.1, data: [LANGUAGE_FULL] });
      }
      return jsonResponse({ data: [MEDIA_MODEL] });
    });

    const result = await fetchModelCatalog({ apiKey: "k", fetchImpl, now: new Date(capturedAt) });

    expect(result.errors.map((row) => row.modality)).toEqual(["text-to-video"]);
    const failed = result.catalog.sections.find((section) => section.modality === "text-to-video");
    expect(failed?.models).toEqual([]);
    expect(failed?.notes[0]).toMatch(/indisponível/);
    // A partial capture still publishes what did answer.
    const language = result.catalog.sections.find((section) => section.modality === "language");
    expect(language?.models).toHaveLength(1);
  });

  it("requests every modality exactly once", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn((input: Parameters<typeof fetch>[0]) => {
      seen.push(requestUrl(input));
      return Promise.resolve(jsonResponse({ data: [] }));
    }) as unknown as typeof fetch;

    await fetchModelCatalog({ apiKey: "k", fetchImpl });

    const expected = (Object.keys(AA_ENDPOINTS) as Modality[]).map(
      (modality) => `${AA_BASE}${AA_ENDPOINTS[modality]}`
    );
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(seen.length);
  });
});
