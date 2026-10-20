import { editionsUrl } from "./paths.js";

/**
 * Reader-side view of the published model catalogue.
 *
 * Mirrors the wire format from the publisher. Every number arrives as an observation with
 * its source, benchmark and capture date, and the UI is expected to show those rather than
 * present a bare figure as fact.
 */

export type Modality =
  | "language"
  | "text-to-image"
  | "image-editing"
  | "text-to-video"
  | "image-to-video"
  | "text-to-video-audio"
  | "image-to-video-audio";

export type ModalityGroup = "texto" | "imagem" | "video";

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

export type MetricNature = "capability" | "preference" | "price" | "speed";

export interface MetricObservation {
  metric: MetricKey;
  value: number;
  source: "artificial-analysis";
  benchmark: string;
  benchmarkVersion?: string;
  confidence95?: number;
  sampleSize?: number;
  capturedAt: string;
  methodologyUrl: string;
}

export interface ModelRecord {
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
  availableMetrics: MetricKey[];
  models: ModelRecord[];
  /** How many models the source returned, before the publisher's cap. */
  totalAvailable: number;
  notes: string[];
}

export interface ChangedModel {
  id: string;
  name: string;
  creator: string;
}

/** What moved since the previous capture; computed by the kitchen (`backend/src/models/changes.ts`). */
export interface CatalogChanges {
  since: string;
  /** False when the intelligence index changed version: scores then do not compare. */
  comparable: boolean;
  indexVersions?: { before: string | null; after: string | null };
  entered: ChangedModel[];
  left: ChangedModel[];
  moved: Array<ChangedModel & { metric: MetricKey; before: number; after: number }>;
  leaders: Array<{ modality: Modality; before: ChangedModel; after: ChangedModel }>;
}

export interface ModelCatalog {
  schemaVersion: 1;
  capturedAt: string;
  sources: Array<"artificial-analysis">;
  sections: ModalitySection[];
  coverage: Array<{ modality: Modality; metric: MetricKey; withData: number; total: number }>;
  changes?: CatalogChanges;
}

/** Where the numbers come from. Its free API asks for this link wherever they are shown. */
export const AA_HOME_URL = "https://artificialanalysis.ai/";

export interface MetricDisplay {
  label: string;
  unit: string;
  nature: MetricNature;
  higherIsBetter: boolean;
  decimals: number;
}

export const METRIC_DISPLAY: Record<MetricKey, MetricDisplay> = {
  "intelligence-index": {
    label: "Inteligência",
    unit: "índice",
    nature: "capability",
    higherIsBetter: true,
    decimals: 1,
  },
  "coding-index": {
    label: "Código",
    unit: "índice",
    nature: "capability",
    higherIsBetter: true,
    decimals: 1,
  },
  "agentic-index": {
    label: "Agêntico",
    unit: "índice",
    nature: "capability",
    higherIsBetter: true,
    decimals: 1,
  },
  "price-input-1m": {
    label: "Entrada",
    unit: "US$/1M tokens",
    nature: "price",
    higherIsBetter: false,
    decimals: 2,
  },
  "price-output-1m": {
    label: "Saída",
    unit: "US$/1M tokens",
    nature: "price",
    higherIsBetter: false,
    decimals: 2,
  },
  "output-tokens-per-second": {
    label: "Velocidade",
    unit: "tokens/s",
    nature: "speed",
    higherIsBetter: true,
    decimals: 0,
  },
  "time-to-first-token": {
    label: "1º token",
    unit: "s",
    nature: "speed",
    higherIsBetter: false,
    decimals: 2,
  },
  "end-to-end-latency": {
    label: "Resposta",
    unit: "s",
    nature: "speed",
    higherIsBetter: false,
    decimals: 2,
  },
  "arena-elo": {
    label: "Preferência (Elo)",
    unit: "Elo",
    nature: "preference",
    higherIsBetter: true,
    decimals: 0,
  },
};

export const MODALITY_LABEL: Record<Modality, string> = {
  language: "Texto e multimodal",
  "text-to-image": "Texto para imagem",
  "image-editing": "Edição de imagem",
  "text-to-video": "Texto para vídeo",
  "image-to-video": "Imagem para vídeo",
  "text-to-video-audio": "Texto para vídeo com áudio",
  "image-to-video-audio": "Imagem para vídeo com áudio",
};

export const GROUP_LABEL: Record<ModalityGroup, string> = {
  texto: "Texto e multimodal",
  imagem: "Imagem",
  video: "Vídeo",
};

export function fetchModelCatalog(): Promise<ModelCatalog> {
  return fetch(editionsUrl("models.json")).then((response) => {
    if (!response.ok) throw new Error(`Não foi possível ler o catálogo (${response.status})`);
    return response.json() as Promise<ModelCatalog>;
  });
}

export function observationFor(model: ModelRecord, metric: MetricKey): MetricObservation | undefined {
  return model.observations.find((observation) => observation.metric === metric);
}

/** Renders a value with its unit, or an em dash when the source has no number. */
export function formatObservation(observation: MetricObservation | undefined): string {
  if (!observation) return "—";
  const display = METRIC_DISPLAY[observation.metric];
  const value = observation.value.toFixed(display.decimals);
  if (observation.confidence95 !== undefined) {
    return `${value} ± ${observation.confidence95.toFixed(display.decimals)}`;
  }
  return value;
}

/**
 * Sorts models by one metric, keeping models without that metric out of the ranking.
 *
 * Treating a missing value as zero would put unpriced models at the top of a "cheapest"
 * list, which is the most misleading thing this page could do.
 */
export function rankBy(
  models: ModelRecord[],
  metric: MetricKey
): { ranked: ModelRecord[]; withoutData: ModelRecord[] } {
  const display = METRIC_DISPLAY[metric];
  const ranked: ModelRecord[] = [];
  const withoutData: ModelRecord[] = [];

  for (const model of models) {
    if (observationFor(model, metric)) ranked.push(model);
    else withoutData.push(model);
  }

  ranked.sort((a, b) => {
    const left = observationFor(a, metric)!.value;
    const right = observationFor(b, metric)!.value;
    return display.higherIsBetter ? right - left : left - right;
  });

  return { ranked, withoutData };
}

export function coverageFor(
  catalog: ModelCatalog,
  modality: Modality,
  metric: MetricKey
): { withData: number; total: number } | undefined {
  return catalog.coverage.find((row) => row.modality === modality && row.metric === metric);
}

export function sectionsInGroup(catalog: ModelCatalog, group: ModalityGroup): ModalitySection[] {
  return catalog.sections.filter((section) => section.group === group && section.models.length > 0);
}

export function groupsWithData(catalog: ModelCatalog): ModalityGroup[] {
  const groups: ModalityGroup[] = ["texto", "imagem", "video"];
  return groups.filter((group) => sectionsInGroup(catalog, group).length > 0);
}
