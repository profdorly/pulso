import { observationFor, rankBy, type MetricKey, type ModelRecord } from "./modelCatalog.js";

/**
 * Ready answers to the questions a reader brings to /modelos — the smartest, the fastest, the
 * cheapest, the best value — computed from the same observations the table shows, with every
 * rule stated on the page.
 */

/**
 * Splits "Claude Opus 5 (Adaptive Reasoning, Max Effort)" into the model and its configuration.
 *
 * The source names configurations in parentheses. Set as one string, those names wrapped into
 * five lines in a narrow column and the model itself was lost; set apart, the name reads first
 * and the configuration becomes a quiet second line.
 */
export function splitModelLabel(label: string): { name: string; variant: string | null } {
  const match = /^(.*?)\s*\((.+)\)\s*$/.exec(label);
  return match ? { name: match[1]!, variant: match[2]! } : { name: label, variant: null };
}

/**
 * The model a row belongs to, without its configuration. Copy of `modelFamily` in
 * `backend/src/models/family.ts`; keep the two in step.
 */
export function modelFamily(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
}

/** The first model of each family, in the order given: pass models already ranked. */
export function bestOfEachFamily(models: readonly ModelRecord[]): ModelRecord[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    const family = modelFamily(model.name);
    if (seen.has(family)) return false;
    seen.add(family);
    return true;
  });
}

/**
 * One price per model: three input tokens to one output token, the blend Artificial Analysis
 * itself uses. Undefined unless both prices are published.
 */
export function blendedPrice(model: ModelRecord): number | undefined {
  const input = observationFor(model, "price-input-1m")?.value;
  const output = observationFor(model, "price-output-1m")?.value;
  if (input === undefined || output === undefined) return undefined;
  return (3 * input + output) / 4;
}

export interface PricedModel {
  model: ModelRecord;
  price: number;
  index: number;
}

/** Every model with both an intelligence index and a blended price. */
export function pricedModels(models: readonly ModelRecord[]): PricedModel[] {
  const priced: PricedModel[] = [];
  for (const model of models) {
    const price = blendedPrice(model);
    const index = observationFor(model, "intelligence-index")?.value;
    if (price !== undefined && index !== undefined) priced.push({ model, price, index });
  }
  return priced;
}

/**
 * The value frontier: models no other model beats on intelligence and price at once — the most
 * intelligent at its price or below. Cheapest first; each step up costs more and scores more.
 */
export function priceFrontier(models: readonly ModelRecord[]): PricedModel[] {
  const ordered = pricedModels(models).sort((a, b) => a.price - b.price || b.index - a.index);
  const frontier: PricedModel[] = [];
  for (const point of ordered) {
    if (frontier.length === 0 || point.index > frontier[frontier.length - 1]!.index) frontier.push(point);
  }
  return frontier;
}

export interface Pick {
  model: ModelRecord;
  /** The number shown, already formatted with its unit. */
  display: string;
}

export interface PickList {
  id: string;
  title: string;
  /** How the list was made, in one sentence. */
  rule: string;
  picks: Pick[];
}

function formatPrice(value: number): string {
  return `US$ ${value < 1 ? value.toFixed(2) : value.toFixed(value < 10 ? 2 : 1)}`;
}

function topBy(models: readonly ModelRecord[], metric: MetricKey, size: number, unit: (value: number) => string): Pick[] {
  return bestOfEachFamily(rankBy([...models], metric).ranked)
    .slice(0, size)
    .map((model) => ({ model, display: unit(observationFor(model, metric)!.value) }));
}

/** The four ready lists for the language section, each one model per family. Empty lists are left out. */
export function modelPicks(models: readonly ModelRecord[], size = 3): PickList[] {
  // The page publishes the models with the highest index, not the whole market: every list but
  // the first is a choice within that cut, and says so.
  const among = `os ${models.length} modelos de maior índice`;
  const leaderId = rankBy([...models], "intelligence-index").ranked[0]?.id;
  const cheapest = bestOfEachFamily(pricedModels(models).sort((a, b) => a.price - b.price).map((point) => point.model))
    .slice(0, size)
    .map((model) => ({ model, display: `${formatPrice(blendedPrice(model)!)}/1M` }));

  const lists: PickList[] = [
    {
      id: "mais-inteligente",
      title: "Mais inteligente",
      rule: "Maior índice de inteligência da Artificial Analysis.",
      picks: topBy(models, "intelligence-index", size, (value) => value.toFixed(1)),
    },
    {
      id: "mais-rapido",
      title: "Mais rápido",
      rule: `Entre ${among}: mais tokens por segundo na resposta, mediana medida.`,
      picks: topBy(models, "output-tokens-per-second", size, (value) => `${value.toFixed(0)} tokens/s`),
    },
    {
      id: "mais-barato",
      title: "Mais barato",
      rule: `Entre ${among}: menor preço por milhão de tokens, 3 de entrada para 1 de saída.`,
      picks: cheapest,
    },
    {
      id: "custo-beneficio",
      title: "Melhor custo-benefício",
      rule: `Entre ${among}: cada um é o mais inteligente pelo seu preço ou menos; o líder geral fica de fora.`,
      // The overall leader is already the first "mais inteligente". The frontier's steps below it,
      // strongest first, are the answer a reader looking for value wants.
      picks: priceFrontier(models)
        .reverse()
        .filter((point) => point.model.id !== leaderId)
        .slice(0, size)
        .map((point) => ({ model: point.model, display: `${point.index.toFixed(1)} por ${formatPrice(point.price)}` })),
    },
  ];
  return lists.filter((list) => list.picks.length > 0);
}
