import { PRIMARY_METRIC } from "./aa.js";
import { observationFor, type CatalogChanges, type MetricKey, type ModelCatalog, type ModelRecord } from "./types.js";

/**
 * What moved between two catalogue captures, for "o que mudou" on /modelos.
 *
 * Only the language list is compared model by model: it is the one with evaluations and prices.
 * For every other modality the page says only whether the top of the board changed hands — Elo
 * drifts a little every week, and listing each drift would be noise.
 *
 * A move has to be worth a reader's attention: a point of index, or a price change. When the
 * index changed version between the two captures the scores are not comparable at all, so no
 * score move is reported and the page says why.
 */

/** Smallest index move reported. The index is published to one decimal; less than a point is noise. */
export const MIN_INDEX_MOVE = 1;
/** Prices are list prices; any change is a real change, but float noise is not. */
const MIN_PRICE_CHANGE = 0.005;
const MAX_MOVES = 12;

const PRICE_METRICS: MetricKey[] = ["price-input-1m", "price-output-1m"];

function languageModels(catalog: ModelCatalog): ModelRecord[] {
  return catalog.sections.find((section) => section.modality === "language")?.models ?? [];
}

function indexVersion(models: ModelRecord[]): string | undefined {
  for (const model of models) {
    const version = observationFor(model, "intelligence-index")?.benchmarkVersion;
    if (version) return version;
  }
  return undefined;
}

function brief(model: ModelRecord) {
  return { id: model.id, name: model.name, creator: model.creator };
}

export function catalogChanges(previous: ModelCatalog | null, next: ModelCatalog): CatalogChanges | null {
  if (!previous) return null;

  const before = languageModels(previous);
  const after = languageModels(next);
  // A modality that failed in either capture has nothing to compare; an empty list is not a
  // list everyone left, nor a sign the index changed version.
  const bothAnswered = before.length > 0 && after.length > 0;
  const beforeById = new Map(before.map((model) => [model.id, model]));
  const afterIds = new Set(after.map((model) => model.id));

  const versionBefore = indexVersion(before);
  const versionAfter = indexVersion(after);
  const comparable = !bothAnswered || versionBefore === versionAfter;

  const moved: CatalogChanges["moved"] = [];
  if (bothAnswered) {
    for (const model of after) {
      const old = beforeById.get(model.id);
      if (!old) continue;
      const metrics: MetricKey[] = comparable ? ["intelligence-index", ...PRICE_METRICS] : PRICE_METRICS;
      for (const metric of metrics) {
        const was = observationFor(old, metric)?.value;
        const now = observationFor(model, metric)?.value;
        if (was === undefined || now === undefined) continue;
        const threshold = metric === "intelligence-index" ? MIN_INDEX_MOVE : Math.max(MIN_PRICE_CHANGE, was * 0.005);
        if (Math.abs(now - was) < threshold) continue;
        moved.push({ ...brief(model), metric, before: was, after: now });
      }
    }
  }
  moved.sort((a, b) => Math.abs(b.after - b.before) / (Math.abs(b.before) || 1) - Math.abs(a.after - a.before) / (Math.abs(a.before) || 1));

  const leaders: CatalogChanges["leaders"] = [];
  for (const section of next.sections) {
    if (section.modality === "language") continue;
    const old = previous.sections.find((candidate) => candidate.modality === section.modality);
    const leaderNow = section.models[0];
    const leaderBefore = old?.models[0];
    if (!leaderNow || !leaderBefore || leaderNow.id === leaderBefore.id) continue;
    const metric = PRIMARY_METRIC[section.modality];
    if (!observationFor(leaderNow, metric)) continue;
    leaders.push({ modality: section.modality, before: brief(leaderBefore), after: brief(leaderNow) });
  }

  return {
    since: previous.capturedAt,
    comparable,
    ...(comparable ? {} : { indexVersions: { before: versionBefore ?? null, after: versionAfter ?? null } }),
    entered: bothAnswered ? after.filter((model) => !beforeById.has(model.id)).map(brief) : [],
    left: bothAnswered ? before.filter((model) => !afterIds.has(model.id)).map(brief) : [],
    moved: moved.slice(0, MAX_MOVES),
    leaders,
  };
}
