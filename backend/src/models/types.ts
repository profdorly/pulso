/**
 * Canonical model catalogue.
 *
 * Every number is an observation with its own provenance — source, metric, unit, capture
 * date, and uncertainty when the source reports it. Nothing is averaged across sources and
 * nothing is flattened into a single score, because the metrics come from different
 * methodologies and a combined number would imply a comparison that does not exist.
 *
 * Field coverage is uneven (see research/aa-coverage.md): price is present for ~68% of
 * language models and speed for ~53%. Absent means absent — never zero.
 */

export const MODALITIES = [
  "language",
  "text-to-image",
  "image-editing",
  "text-to-video",
  "image-to-video",
  "text-to-video-audio",
  "image-to-video-audio",
] as const;

export type Modality = (typeof MODALITIES)[number];

/** Groups shown to the reader. Media modalities carry preference data only. */
export const MODALITY_GROUPS = ["texto", "imagem", "video"] as const;
export type ModalityGroup = (typeof MODALITY_GROUPS)[number];

export const MODALITY_GROUP: Record<Modality, ModalityGroup> = {
  language: "texto",
  "text-to-image": "imagem",
  "image-editing": "imagem",
  "text-to-video": "video",
  "image-to-video": "video",
  "text-to-video-audio": "video",
  "image-to-video-audio": "video",
};

export type MetricSource = "artificial-analysis";

/**
 * What a metric actually measures.
 *
 * `capability` comes from running evaluations; `preference` comes from people voting on
 * pairs. Keeping them apart in the type stops the UI from ranking one against the other.
 */
export type MetricNature = "capability" | "preference" | "price" | "speed";

export type MetricKey =
  | "intelligence-index"
  | "coding-index"
  | "agentic-index"
  | "price-input-1m"
  | "price-output-1m"
  | "output-tokens-per-second"
  | "time-to-first-token"
  | "end-to-end-latency"
  | "arena-elo";

export interface MetricDefinition {
  key: MetricKey;
  label: string;
  nature: MetricNature;
  unit: string;
  /** Whether a higher value is better; null when it is not an ordering at all. */
  higherIsBetter: boolean | null;
  /** How many decimals to render. */
  decimals: number;
}

export const METRICS: Record<MetricKey, MetricDefinition> = {
  "intelligence-index": {
    key: "intelligence-index",
    label: "Índice de inteligência",
    nature: "capability",
    unit: "índice",
    higherIsBetter: true,
    decimals: 1,
  },
  "coding-index": {
    key: "coding-index",
    label: "Índice de código",
    nature: "capability",
    unit: "índice",
    higherIsBetter: true,
    decimals: 1,
  },
  "agentic-index": {
    key: "agentic-index",
    label: "Índice agêntico",
    nature: "capability",
    unit: "índice",
    higherIsBetter: true,
    decimals: 1,
  },
  "price-input-1m": {
    key: "price-input-1m",
    label: "Preço de entrada",
    nature: "price",
    unit: "US$/1M tokens",
    higherIsBetter: false,
    decimals: 2,
  },
  "price-output-1m": {
    key: "price-output-1m",
    label: "Preço de saída",
    nature: "price",
    unit: "US$/1M tokens",
    higherIsBetter: false,
    decimals: 2,
  },
  "output-tokens-per-second": {
    key: "output-tokens-per-second",
    label: "Velocidade",
    nature: "speed",
    unit: "tokens/s",
    higherIsBetter: true,
    decimals: 0,
  },
  "time-to-first-token": {
    key: "time-to-first-token",
    label: "Tempo até o 1º token",
    nature: "speed",
    unit: "s",
    higherIsBetter: false,
    decimals: 2,
  },
  "end-to-end-latency": {
    key: "end-to-end-latency",
    label: "Resposta completa",
    nature: "speed",
    unit: "s",
    higherIsBetter: false,
    decimals: 2,
  },
  "arena-elo": {
    key: "arena-elo",
    label: "Preferência humana (Elo)",
    nature: "preference",
    unit: "Elo",
    higherIsBetter: true,
    decimals: 0,
  },
};

export interface MetricObservation {
  metric: MetricKey;
  value: number;
  source: MetricSource;
  /** Which leaderboard or evaluation set produced it. */
  benchmark: string;
  /** Version of the evaluation suite, when the source reports one. */
  benchmarkVersion?: string;
  /** Half-width of the 95% interval, when the source reports uncertainty. */
  confidence95?: number;
  /** Number of observations behind the value, when reported. */
  sampleSize?: number;
  capturedAt: string;
  /** Where a reader can check how the number is produced. */
  methodologyUrl: string;
}

export interface ModelRecord {
  /** Stable identity: source slug, which is what the source itself keys on. */
  id: string;
  name: string;
  creator: string;
  modality: Modality;
  releaseDate?: string;
  observations: MetricObservation[];
}

export interface ModalitySection {
  modality: Modality;
  group: ModalityGroup;
  /** Which metrics this modality actually has data for. */
  availableMetrics: MetricKey[];
  models: ModelRecord[];
  /** How many models the source returned, before the publish cap. */
  totalAvailable: number;
  /** Non-fatal problems, e.g. a source that did not answer. */
  notes: string[];
}

export interface ModelCatalog {
  schemaVersion: 1;
  capturedAt: string;
  /** Sources that actually answered; drives attribution shown to the reader. */
  sources: MetricSource[];
  sections: ModalitySection[];
  /** Coverage per metric, so the UI can say how many models a sort leaves out. */
  coverage: Array<{ modality: Modality; metric: MetricKey; withData: number; total: number }>;
  /** What moved since the previous capture (`models/changes.ts`); absent on the first one. */
  changes?: CatalogChanges;
}

export interface ChangedModel {
  id: string;
  name: string;
  creator: string;
}

export interface CatalogChanges {
  /** `capturedAt` of the catalogue this one is compared with. */
  since: string;
  /** False when the intelligence index changed version: scores then do not compare. */
  comparable: boolean;
  indexVersions?: { before: string | null; after: string | null };
  /** Language models now on the published list that were not on the previous one. */
  entered: ChangedModel[];
  left: ChangedModel[];
  /** Index (when comparable) and list-price moves on models present in both. */
  moved: Array<ChangedModel & { metric: MetricKey; before: number; after: number }>;
  /** Media boards whose first place changed hands. */
  leaders: Array<{ modality: Modality; before: ChangedModel; after: ChangedModel }>;
}

export function metricsFor(models: ModelRecord[]): MetricKey[] {
  const keys = new Set<MetricKey>();
  for (const model of models) {
    for (const observation of model.observations) keys.add(observation.metric);
  }
  return [...keys];
}

export function observationFor(model: ModelRecord, metric: MetricKey): MetricObservation | undefined {
  return model.observations.find((observation) => observation.metric === metric);
}

/** Counts how many models in a section carry a given metric. */
export function coverageFor(section: ModalitySection, metric: MetricKey): { withData: number; total: number } {
  const withData = section.models.filter((model) => observationFor(model, metric) !== undefined).length;
  return { withData, total: section.models.length };
}
