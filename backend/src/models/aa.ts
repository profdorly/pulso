import {
  MODALITY_GROUP,
  METRICS,
  coverageFor,
  metricsFor,
  observationFor,
  type MetricKey,
  type MetricObservation,
  type Modality,
  type ModalitySection,
  type ModelCatalog,
  type ModelRecord,
} from "./types.js";

/**
 * Builds the model catalogue from the Artificial Analysis free tier.
 *
 * Endpoint coverage was measured, not assumed — see research/aa-coverage.md. Language
 * returns evaluations, price and performance (unevenly). The six media endpoints return
 * identity plus Elo and its 95% interval, and nothing else, so media sections carry
 * preference data only.
 */

export const AA_BASE = "https://artificialanalysis.ai/api/v2";

export const AA_METHODOLOGY_URL = "https://artificialanalysis.ai/methodology";

export const AA_ENDPOINTS: Record<Modality, string> = {
  language: "/language/models/free",
  "text-to-image": "/media/text-to-image/models/free",
  "image-editing": "/media/image-editing/models/free",
  "text-to-video": "/media/text-to-video/models/free",
  "image-to-video": "/media/image-to-video/models/free",
  "text-to-video-audio": "/media/text-to-video-audio/models/free",
  "image-to-video-audio": "/media/image-to-video-audio/models/free",
};

/** Arena leaderboards report preference; the label states which board it came from. */
const MEDIA_BENCHMARK: Record<Modality, string> = {
  language: "Artificial Analysis Intelligence Index",
  "text-to-image": "Text to Image Arena",
  "image-editing": "Image Editing Arena",
  "text-to-video": "Text to Video Arena",
  "image-to-video": "Image to Video Arena",
  "text-to-video-audio": "Text to Video with Audio Arena",
  "image-to-video-audio": "Image to Video with Audio Arena",
};

/**
 * Axis each modality is ordered and capped along.
 *
 * Language has evaluations, so it is capped by capability. Media endpoints only return Elo,
 * so preference is the only axis available there.
 */
export const PRIMARY_METRIC: Record<Modality, MetricKey> = {
  language: "intelligence-index",
  "text-to-image": "arena-elo",
  "image-editing": "arena-elo",
  "text-to-video": "arena-elo",
  "image-to-video": "arena-elo",
  "text-to-video-audio": "arena-elo",
  "image-to-video-audio": "arena-elo",
};

/**
 * How many models per modality reach the published artifact.
 *
 * The full free tier is ~620 models, which serialises to 622 KB and gets inlined into the
 * prerendered `/modelos` HTML — enough to dominate the page weight on its own. The caps are
 * set to what the page actually renders, so nothing is shipped that the reader cannot see.
 * `totalAvailable` records what the source returned, and the page states both numbers along
 * with the axis the cut was taken on, so "o mais barato" is never read as a global claim.
 */
export const LANGUAGE_PUBLISH_CAP = 30;
export const MEDIA_PUBLISH_CAP = 20;

export function publishCapFor(modality: Modality): number {
  return modality === "language" ? LANGUAGE_PUBLISH_CAP : MEDIA_PUBLISH_CAP;
}

/**
 * Orders by the modality's primary metric and keeps the head of the list.
 *
 * A model with no number on the ordering axis sinks to the bottom rather than being dropped
 * outright — it is still a real model, it just cannot be placed.
 */
export function applyPublishCap(
  models: ModelRecord[],
  modality: Modality
): { published: ModelRecord[]; totalAvailable: number } {
  const metric = PRIMARY_METRIC[modality];
  const higherIsBetter = METRICS[metric].higherIsBetter !== false;

  const ordered = [...models].sort((left, right) => {
    const a = observationFor(left, metric)?.value;
    const b = observationFor(right, metric)?.value;
    if (a === undefined && b === undefined) return left.name.localeCompare(right.name);
    if (a === undefined) return 1;
    if (b === undefined) return -1;
    return higherIsBetter ? b - a : a - b;
  });

  return { published: ordered.slice(0, publishCapFor(modality)), totalAvailable: models.length };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

interface ObservationSpec {
  metric: MetricKey;
  value: number | undefined;
  benchmark: string;
  benchmarkVersion?: string;
  confidence95?: number;
}

function buildObservations(specs: ObservationSpec[], capturedAt: string): MetricObservation[] {
  const observations: MetricObservation[] = [];
  for (const spec of specs) {
    if (spec.value === undefined) continue; // absent stays absent, never zero
    observations.push({
      metric: spec.metric,
      value: spec.value,
      source: "artificial-analysis",
      benchmark: spec.benchmark,
      ...(spec.benchmarkVersion ? { benchmarkVersion: spec.benchmarkVersion } : {}),
      ...(spec.confidence95 !== undefined ? { confidence95: spec.confidence95 } : {}),
      capturedAt,
      methodologyUrl: AA_METHODOLOGY_URL,
    });
  }
  return observations;
}

export function mapLanguageModel(
  raw: unknown,
  capturedAt: string,
  indexVersion?: string
): ModelRecord | null {
  const record = asRecord(raw);
  if (!record) return null;

  const id = asString(record.slug) ?? asString(record.id);
  const name = asString(record.name) ?? id;
  if (!id || !name) return null;

  const creator = asString(asRecord(record.model_creator)?.name) ?? "Desconhecido";
  const evaluations = asRecord(record.evaluations) ?? {};
  const pricing = asRecord(record.pricing) ?? {};
  const performance = asRecord(record.performance) ?? {};

  const observations = buildObservations(
    [
      {
        metric: "intelligence-index",
        value: asNumber(evaluations.artificial_analysis_intelligence_index),
        benchmark: "Artificial Analysis Intelligence Index",
        benchmarkVersion: indexVersion,
      },
      {
        metric: "coding-index",
        value: asNumber(evaluations.artificial_analysis_coding_index),
        benchmark: "Artificial Analysis Coding Index",
        benchmarkVersion: indexVersion,
      },
      {
        metric: "agentic-index",
        value: asNumber(evaluations.artificial_analysis_agentic_index),
        benchmark: "Artificial Analysis Agentic Index",
        benchmarkVersion: indexVersion,
      },
      {
        metric: "price-input-1m",
        value: asNumber(pricing.price_1m_input_tokens),
        benchmark: "Preço de tabela do provedor",
      },
      {
        metric: "price-output-1m",
        value: asNumber(pricing.price_1m_output_tokens),
        benchmark: "Preço de tabela do provedor",
      },
      {
        metric: "output-tokens-per-second",
        value: asNumber(performance.median_output_tokens_per_second),
        benchmark: "Medição de performance da Artificial Analysis (mediana)",
      },
      {
        metric: "time-to-first-token",
        value: asNumber(performance.median_time_to_first_token_seconds),
        benchmark: "Medição de performance da Artificial Analysis (mediana)",
      },
      {
        metric: "end-to-end-latency",
        value: asNumber(performance.median_end_to_end_response_time_seconds),
        benchmark: "Medição de performance da Artificial Analysis (mediana)",
      },
    ],
    capturedAt
  );

  if (observations.length === 0) return null;

  const model: ModelRecord = { id, name, creator, modality: "language", observations };
  const releaseDate = asString(record.release_date);
  if (releaseDate) model.releaseDate = releaseDate;
  return model;
}

export function mapMediaModel(
  raw: unknown,
  modality: Modality,
  capturedAt: string
): ModelRecord | null {
  const record = asRecord(raw);
  if (!record) return null;

  const id = asString(record.slug) ?? asString(record.id);
  const name = asString(record.name) ?? id;
  const elo = asNumber(record.elo);
  if (!id || !name || elo === undefined) return null;

  const creator = asString(asRecord(record.model_creator)?.name) ?? "Desconhecido";
  const observations = buildObservations(
    [
      {
        metric: "arena-elo",
        value: elo,
        benchmark: MEDIA_BENCHMARK[modality],
        confidence95: asNumber(record.ci_95),
      },
    ],
    capturedAt
  );

  return { id, name, creator, modality, observations };
}

export interface CatalogFetchOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Restrict which modalities are requested; defaults to all. */
  modalities?: Modality[];
  now?: Date;
}

export interface CatalogFetchResult {
  catalog: ModelCatalog;
  /** Per-modality failures. A partial catalogue is published; a silent one is not. */
  errors: Array<{ modality: Modality; error: string }>;
}

function emptyCatalog(capturedAt: string): ModelCatalog {
  return { schemaVersion: 1, capturedAt, sources: [], sections: [], coverage: [] };
}

function sectionFor(
  modality: Modality,
  models: ModelRecord[],
  notes: string[],
  totalAvailable: number
): ModalitySection {
  return {
    modality,
    group: MODALITY_GROUP[modality],
    availableMetrics: metricsFor(models),
    models,
    totalAvailable,
    notes,
  };
}

export async function fetchModelCatalog(
  options: CatalogFetchOptions = {}
): Promise<CatalogFetchResult> {
  const capturedAt = (options.now ?? new Date()).toISOString();
  const errors: Array<{ modality: Modality; error: string }> = [];

  if (!options.apiKey) {
    return {
      catalog: emptyCatalog(capturedAt),
      errors: [{ modality: "language", error: "ARTIFICIAL_ANALYSIS_API_KEY ausente" }],
    };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const modalities = options.modalities ?? (Object.keys(AA_ENDPOINTS) as Modality[]);
  const sections: ModalitySection[] = [];

  for (const modality of modalities) {
    try {
      const response = await fetchImpl(`${AA_BASE}${AA_ENDPOINTS[modality]}`, {
        headers: { "x-api-key": options.apiKey },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const body = asRecord(JSON.parse(await response.text()));
      const rows = Array.isArray(body?.data) ? body.data : [];
      const indexVersion = asNumber(body?.intelligence_index_version);

      const models =
        modality === "language"
          ? rows
              .map((row) => mapLanguageModel(row, capturedAt, indexVersion ? String(indexVersion) : undefined))
              .filter((row): row is ModelRecord => row !== null)
          : rows
              .map((row) => mapMediaModel(row, modality, capturedAt))
              .filter((row): row is ModelRecord => row !== null);

      const notes: string[] = [];
      if (rows.length > 0 && models.length === 0) {
        notes.push("a fonte respondeu, mas nenhum modelo tinha número utilizável");
      }
      const { published, totalAvailable } = applyPublishCap(models, modality);
      sections.push(sectionFor(modality, published, notes, totalAvailable));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ modality, error: message });
      sections.push(sectionFor(modality, [], [`fonte indisponível nesta captura: ${message}`], 0));
    }
  }

  const coverage = sections.flatMap((section) =>
    section.availableMetrics.map((metric) => ({
      modality: section.modality,
      metric,
      ...coverageFor(section, metric),
    }))
  );

  const answered = sections.some((section) => section.models.length > 0);

  return {
    catalog: {
      schemaVersion: 1,
      capturedAt,
      sources: answered ? ["artificial-analysis"] : [],
      sections,
      coverage,
    },
    errors,
  };
}

/** Metric definitions the reader needs to label numbers; shipped with the artifact. */
export function metricDefinitions() {
  return METRICS;
}
